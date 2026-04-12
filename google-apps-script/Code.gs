// ---- CONFIGURATION ----
const CHORES_SHEET = "Chores";
const MEMBERS_SHEET = "Members";
const HISTORY_SHEET = "History";
const AVAIL_SHEET = "Availability";
const CURRENT_CHORES_SHEET = "Current Assignments";
const CHORE_COUNT = "Counts"; // Defines the name of your counts sheet
const DISCORD_WEBHOOK_URL = "";
const HOUSE_NAME = "GA House";
// Using the provided checklist link from search result [1]
const CHECKLIST_LINK = "";
// ---- NEW: Chore submission website ----
const CHORE_SUBMIT_URL = "https://kushaangupta.github.io/chores/";


// ---- MENU ----
/**
 * Creates a custom menu in the spreadsheet UI when the spreadsheet is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Chore Tools')
    .addItem('1. Assign Chores', 'assignChores')
    .addItem('2. Send Notifications & Log History', 'sendNotificationsAndLogHistory')
    .addItem('3. Recalculate Counts from History', 'recalculateCountsFromHistory')
    .addSeparator()
    .addItem('Create/Update Weekly Trigger', 'createWeeklyTrigger')
    .addSeparator()
    .addItem('Seed Subtasks (one-time)', 'seedSubtasks')
    .addToUi();
}


// ---- CHORE ASSIGNMENT (Robyn's Algorithm) ----
/**
 * Assign exactly one chore to each eligible person.
 * Chores are considered in priority order (random within each priority bucket).
 * For each chore, pick among remaining people the ones with the minimum normalized count
 * for that chore; break ties by least recent.
 */
function assignChores() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const upcomingMonday = getUpcomingMonday();

    // core algorithm
    const chores = getChoresByPriority(ss);
    let people = getAvailablePeople(ss, upcomingMonday); // NetIDs

    const assignments = []; // { chore, netId }

    for (const chore of chores) {
        if (people.length === 0) break;

        const eligible = getEligiblePeople(ss, chore, people);
        if (eligible.length === 0) continue;

        const chosen =
            (eligible.length === 1)
                ? eligible[0]
                : getLeastRecent(ss, chore.id, eligible);

        assignments.push({ chore: chore, netId: chosen });

        people = people.filter(id => id !== chosen);
    }

    // formatting
    const weekStr = Utilities.formatDate(
        upcomingMonday,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
    );

    const members = getActiveMembers(ss);
    const outputRows = [];

    // Build availability map for this week
    const availabilitySheet = ss.getSheetByName(AVAIL_SHEET);
    const availabilityData = availabilitySheet.getDataRange().getValues();
    const availabilityMap = {}; // netId -> note

    const targetTime = new Date(upcomingMonday).setHours(0, 0, 0, 0);

    for (let i = 1; i < availabilityData.length; i++) {
        const rowDate = availabilityData[i][0];
        const netId = String(availabilityData[i][1]).trim();
        const status = String(availabilityData[i][2]).trim().toLowerCase();
        const note = availabilityData[i][3] || "";

        if (!(rowDate instanceof Date)) continue;

        const rowTime = new Date(rowDate).setHours(0, 0, 0, 0);

        if (rowTime === targetTime && netId) {
            availabilityMap[netId] = note;
        }
    }

    members.forEach(member => {
        const assignment = assignments.find(a => a.netId === member.id);

        if (assignment) {
            const counts = getNormalizedCounts(
                ss,
                assignment.chore.id,
                [member.id]
            );
            const choreCount = counts[member.id] || 0;

            outputRows.push({
                memberName: member.name,
                choreOrStatus: assignment.chore.choreName,
                choreCount: choreCount,
                choreNotes: assignment.chore.notes || ""
            });
        } else {
            const note = availabilityMap[member.id] || "";
            const displayNote = note ? note : "No specific note.";

            outputRows.push({
                memberName: member.name,
                choreOrStatus: `Unavailable (${displayNote})`,
                choreCount: "",
                choreNotes: ""
            });
        }
    });

    outputRows.sort((a, b) =>
        a.memberName.localeCompare(b.memberName)
    );

    updateCurrentAssignmentsSheet(ss, outputRows, weekStr);

    const assignedCount = assignments.length;
    const totalMembers = members.length;
    SpreadsheetApp.getUi().alert(
      `Assignments processed for week starting ${weekStr}!\n\n` +
      `${assignedCount} chores assigned out of ${chores.length} chores and ${totalMembers} members.`
    );
}


/**
 * Fisher–Yates shuffle (in-place).
 */
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/**
 * Returns chores ordered by priority (1 first, then 2, then 3)
 * with random order within each priority level.
 */
function getChoresByPriority(ss) {
    const chores = getChores(ss);
    const buckets = { 1: [], 2: [], 3: [] };

    chores.forEach(ch => {
        const level = Number(ch.importance); // 1, 2, or 3
        if (buckets[level]) {
            buckets[level].push(ch);
        }
    });

    shuffleInPlace(buckets[1]);
    shuffleInPlace(buckets[2]);
    shuffleInPlace(buckets[3]);

    return [...buckets[1], ...buckets[2], ...buckets[3]];
}

/**
 * Returns a randomly sorted array of netIDs corresponding to people
 * that marked 'Yes' on the Availability sheet for the given week.
 */
function getAvailablePeople(ss, upcomingMonday) {
    const sheet = ss.getSheetByName(AVAIL_SHEET);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const yesPeople = [];

    const targetTime = new Date(upcomingMonday).setHours(0, 0, 0, 0);

    for (let i = 1; i < data.length; i++) {
        const dateValue = data[i][0];
        const memberId = String(data[i][1]).trim();
        const status = String(data[i][2]).trim().toLowerCase();

        if (!(dateValue instanceof Date)) continue;

        const rowTime = new Date(dateValue).setHours(0, 0, 0, 0);

        if (rowTime === targetTime && status === "yes" && memberId) {
            yesPeople.push(memberId);
        }
    }

    shuffleInPlace(yesPeople);
    return yesPeople;
}

/**
 * Returns a randomly ordered list of NetIDs in `people` who are eligible for `chore`
 * AND have the minimum normalized count for that chore among eligible people.
 * Eligible = in `people` AND has NOT done this chore in the last 2 weeks.
 */
function getEligiblePeople(ss, chore, people) {
    const choreId = String(chore.id).trim();

    // exclude people who did it in last n weeks
    const n = 2;
    const recent = getHistory(ss, n);

    const eligible = [];
    for (let i = 0; i < people.length; i++) {
        const netId = String(people[i]).trim();

        const didRecently = recent.some(h =>
            String(h.memberId).trim() === netId &&
            String(h.choreId).trim() === choreId
        );

        if (!didRecently) eligible.push(netId);
    }

    if (eligible.length <= 1) return eligible;

    shuffleInPlace(eligible);

    const counts = getNormalizedCounts(ss, choreId, eligible);

    let minVal = Infinity;
    let best = [];

    for (let i = 0; i < eligible.length; i++) {
        const netId = eligible[i];
        const count = Number(counts[netId]) || 0;

        // immediate return if count is 0
        if (count === 0) return [netId];

        if (count < minVal) {
            minVal = count;
            best = [netId];
        } else if (count === minVal) {
            best.push(netId);
        }
    }

    return best;
}

/**
 * Returns the NetID in `people` who has gone the longest without doing
 * the given `choreId`, according to the History sheet.
 * If a person has never done the chore, they are returned immediately.
 */
function getLeastRecent(ss, choreId, people) {
    shuffleInPlace(people);
    if (!people || people.length === 0) return null;
    if (people.length === 1) return people[0];

    const sh = ss.getSheetByName(HISTORY_SHEET);
    if (!sh) return people[0];

    const data = sh.getDataRange().getValues();
    const choreKey = String(choreId).trim();

    let bestPerson = null;
    let bestDate = null;

    for (let i = 0; i < people.length; i++) {
        const netId = String(people[i]).trim();
        let mostRecent = null;

        for (let r = 1; r < data.length; r++) {
            if (String(data[r][1]).trim() === netId &&
                String(data[r][2]).trim() === choreKey) {
                const d = new Date(data[r][0]);
                if (!mostRecent || d > mostRecent) {
                    mostRecent = d;
                }
            }
        }
        if (!mostRecent) return netId;

        if (!bestDate || mostRecent < bestDate) {
            bestPerson = netId;
            bestDate = mostRecent;
        }
    }

    return bestPerson;
}


// ---- NOTIFICATION SENDER & HISTORY LOGGER ----
/**
 * Reads 'Current Assignments', logs ACTUAL assignments to 'History', and sends notifications.
 */
function sendNotificationsAndLogHistory() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CURRENT_CHORES_SHEET);
    if (!sheet) {
        SpreadsheetApp.getUi().alert(`'${CURRENT_CHORES_SHEET}' sheet not found. Please run 'Assign Chores' first.`);
        return;
    }
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
        SpreadsheetApp.getUi().alert(`No data found in the '${CURRENT_CHORES_SHEET}' sheet.`);
        return;
    }

    // --- Prepare Data for History Logging and Notifications ---
    const historyToSave = [];
    const assignmentsForNotification = [];

    // Fetch Member and Chore data to look up IDs by Name
    const membersData = getActiveMembers(ss);
    const choresData = getChores(ss);
    const memberMap = {}; // Map: Name -> { id, email }
    const choreMap = {};  // Map: ChoreName -> { id, notes }
    membersData.forEach(m => { memberMap[m.name] = { id: m.id, email: m.email }; });
    choresData.forEach(c => { choreMap[c.choreName] = { id: c.id, notes: c.notes }; });

    // Properly format the "Week Of" date — data[1][3] is often a Date object
    // because Google Sheets auto-parses "2026-02-23" into a Date.
    var rawWeekOf = data[1][3];
    var weekOfStr = '';
    if (rawWeekOf instanceof Date && !isNaN(rawWeekOf.getTime())) {
      weekOfStr = Utilities.formatDate(rawWeekOf, Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else if (rawWeekOf) {
      weekOfStr = String(rawWeekOf).trim();
    }
    if (!weekOfStr) {
        SpreadsheetApp.getUi().alert(`Could not determine 'Week Of' date from '${CURRENT_CHORES_SHEET}' (expected in cell D2). Cannot log history accurately.`);
        return;
    }

    const timestamp = new Date();

    for (let i = 1; i < data.length; i++) {
        const memberName = String(data[i][0]).trim();
        const choreOrStatus = String(data[i][1]).trim();

        const looksLikeStatus = [
            "UNAVAILABLE", "AVAILABILITY NOT PROVIDED", "NO CHORE ASSIGNED", "STATUS:"
        ].some(prefix => choreOrStatus.toUpperCase().includes(prefix));

        if (memberName && choreOrStatus && !looksLikeStatus) {
            const memberInfo = memberMap[memberName];
            const choreInfo = choreMap[choreOrStatus];

            if (memberInfo && choreInfo) {
                historyToSave.push({
                    weekStartDate: weekOfStr,
                    memberId: memberInfo.id,
                    choreId: choreInfo.id,
                    memberName: memberName,
                    choreName: choreOrStatus,
                    timestamp: timestamp
                });

                assignmentsForNotification.push({
                    member: { name: memberName, email: memberInfo.email },
                    chore: { choreName: choreOrStatus, notes: choreInfo.notes }
                });
            } else {
                if (!memberInfo) Logger.log(`Warning: Could not find Member ID for name "${memberName}" while preparing history/notifications.`);
                if (!choreInfo) Logger.log(`Warning: Could not find Chore ID for name "${choreOrStatus}" while preparing history/notifications.`);
            }
        }
    }


    // --- Log to History Sheet and Update Counts ---
    let historySavedCount = 0;
    if (historyToSave.length > 0) {
        historySavedCount = saveHistoryFromData(ss, historyToSave);
        incrementCountsFromHistoryRows(ss, historyToSave);
        normalizeChoreCounts(ss);
    } else {
        Logger.log("No actual assignments found in 'Current Assignments' to log to history.");
    }

    // --- Send Notifications ---
    let notificationsSent = false;
    if (assignmentsForNotification.length > 0) {
        let weekDate;
        try {
            weekDate = new Date(weekOfStr + "T00:00:00");
            if (isNaN(weekDate.getTime())) weekDate = getUpcomingMonday();
        } catch (e) {
            weekDate = getUpcomingMonday();
        }

        sendEmailNotification(assignmentsForNotification, weekDate);
        sendDiscordNotification(assignmentsForNotification, weekDate);
        notificationsSent = true;
    } else {
        Logger.log("No actual assignments found in 'Current Assignments' to send notifications for.");
    }

    // --- Final Alert ---
    let alertMessage = "";
    if (historySavedCount > 0) {
        alertMessage += `${historySavedCount} assignments logged to '${HISTORY_SHEET}'.\n`;
    } else {
        alertMessage += "No assignments logged to history.\n";
    }
    if (notificationsSent) {
        alertMessage += `Notifications sent for ${assignmentsForNotification.length} assignments!`;
    } else {
        alertMessage += "No notifications sent.";
    }
    SpreadsheetApp.getUi().alert(alertMessage);
}

/**
 * Increment Counts sheet by +1 for each {memberId, choreId} in historyRows.
 * (Does NOT normalize; call normalizeChoreCounts(ss) after.)
 */
function incrementCountsFromHistoryRows(ss, historyRows) {
    const sh = ss.getSheetByName(CHORE_COUNT);
    if (!sh) throw new Error(`Missing sheet: ${CHORE_COUNT}`);

    const range = sh.getDataRange();
    const data = range.getValues(); // row 1 headers, col A = NetID

    if (data.length < 2 || data[0].length < 2) return;

    const headers = data[0].map(x => String(x).trim());
    const choreIdToCol = {};
    for (let c = 1; c < headers.length; c++) choreIdToCol[headers[c]] = c;

    const netIdToRow = {};
    for (let r = 1; r < data.length; r++) {
        const netId = String(data[r][0]).trim();
        if (netId) netIdToRow[netId] = r;
    }

    historyRows.forEach(h => {
        const netId = String(h.memberId).trim();
        const choreId = String(h.choreId).trim();

        const r = netIdToRow[netId];
        const c = choreIdToCol[choreId];
        if (r == null || c == null) return;

        data[r][c] = (Number(data[r][c]) || 0) + 1;
    });

    range.setValues(data);
}

/**
 * Utility function to periodically ensure the Counts sheet is perfectly in sync with the History sheet.
 * Clears all counts, re-sums them from the entire History, and re-normalizes.
 */
function recalculateCountsFromHistory() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Wipe all current counts to 0
    const sh = ss.getSheetByName(CHORE_COUNT);
    if (!sh) throw new Error(`Missing sheet: ${CHORE_COUNT}`);
    
    const range = sh.getDataRange();
    const data = range.getValues();
    
    if (data.length < 2 || data[0].length < 2) return;
    
    // Clear all numerical cells (rows > 0, cols > 0)
    for (let r = 1; r < data.length; r++) {
        for (let c = 1; c < data[0].length; c++) {
            data[r][c] = 0;
        }
    }
    range.setValues(data);
    
    // 2. Fetch entire history and replay it
    const allHistory = getHistory(ss, 0); // 0 means all history
    incrementCountsFromHistoryRows(ss, allHistory);
    
    // 3. Re-normalize the newly summed counts
    normalizeChoreCounts(ss);
    
    SpreadsheetApp.getUi().alert("Counts have been fully recalculated and normalized from the History sheet.");
}

// ---- DATA FETCHING HELPERS ----
/**
 * Fetches chore details. Returns ID, Name, Importance, Notes.
 * Importance should be numeric (1, 2, 3).
 */
function getChores(ss) {
    const sheet = ss.getSheetByName(CHORES_SHEET);
    if (!sheet) { Logger.log(`Error: Sheet "${CHORES_SHEET}" not found.`); return []; }
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map(row => ({
        id: String(row[0]).trim(),
        choreName: String(row[1]).trim(),
        importance: String(row[2]).trim().toLowerCase(),
        notes: row[3] || ""
    })).filter(c => c.id && c.choreName);
}

/**
 * Fetches active/visitor member details. Returns NetID, Name, Email, Status, Notes.
 */
function getActiveMembers(ss) {
    const sheet = ss.getSheetByName(MEMBERS_SHEET);
    if (!sheet) { Logger.log(`Error: Sheet "${MEMBERS_SHEET}" not found.`); return []; }
    const data = sheet.getDataRange().getValues();

    return data.slice(1).map(row => ({
        id: String(row[0]).trim(),      // NetID (the stable key)
        name: String(row[1]).trim(),
        email: String(row[2]).trim(),
        status: String(row[3]).trim(),
        notes: row[4] || ""
    })).filter(m => m.id && m.name && m.email);
}


/**
 * Fetches chore assignment history.
 * If weeksBack > 0, fetches for that many weeks.
 * If weeksBack is 0 or null, fetches ALL history.
 */
function getHistory(ss, weeksBack) {
    const sheet = ss.getSheetByName(HISTORY_SHEET);
    if (!sheet) { Logger.log(`Error: Sheet "${HISTORY_SHEET}" not found.`); return []; }
    const data = sheet.getDataRange().getValues();
  const now = new Date();
    const cutoff = (weeksBack > 0)
        ? new Date(now.getTime() - (weeksBack * 7 * 24 * 60 * 60 * 1000))
        : null;

    return data.slice(1).map(row => {
        let entryDate = null;
        const dateValue = row[0];
        const memberId = String(row[1]).trim();
        const choreId = String(row[2]).trim();
        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            entryDate = dateValue;
        } else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
            try {
                let d = new Date(dateValue);
                if (!isNaN(d.getTime())) entryDate = d;
            } catch (e) { Logger.log(`Could not parse date value: ${dateValue} in ${HISTORY_SHEET}`); }
        }
        return { date: entryDate, memberId: memberId, choreId: choreId };
    })
        .filter(h => h.date && h.memberId && h.choreId && (!cutoff || h.date >= cutoff));
}

/**
 * Normalizes the counts of each chore on the Counts sheet:
 * For each chore column, subtract the minimum value so the lowest becomes 0.
 * This ensures anyone joining gets a count of 0 and scores typically stay in 0, +1, +2.
 */
function normalizeChoreCounts(ss) {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CHORE_COUNT);
    if (!sh) throw new Error(`Missing sheet: "${CHORE_COUNT}"`);

    const range = sh.getDataRange();
    const data = range.getValues(); // row 1 = headers, col A = NetID

    const numRows = data.length;
    const numCols = data[0].length;

    for (let c = 1; c < numCols; c++) {
        let minVal = Infinity;

        for (let r = 1; r < numRows; r++) {
            const v = Number(data[r][c]);
            if (!isNaN(v)) minVal = Math.min(minVal, v);
        }
        if (!isFinite(minVal) || minVal === 0) continue;

        for (let r = 1; r < numRows; r++) {
            const v = Number(data[r][c]);
            data[r][c] = isNaN(v) ? data[r][c] : v - minVal;
        }
    }
    range.setValues(data);
}


/**
 * Returns object mapping each NetID in `people` to their normalized count
 * for the given `choreId` from the Counts sheet.
 */
function getNormalizedCounts(ss, choreId, people) {
    const sh = ss.getSheetByName(CHORE_COUNT);
    if (!sh) throw new Error(`Missing sheet: "${CHORE_COUNT}"`);

    const data = sh.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());

    const choreCol = headers.indexOf(String(choreId));
    if (choreCol === -1) return {};

    const result = {};

    for (let i = 1; i < data.length; i++) {
        const netId = String(data[i][0]).trim();
        if (!people.includes(netId)) continue;

        result[netId] = Number(data[i][choreCol]) || 0;
    }
    return result;
}

// ---- ACTION HELPERS ----
/**
 * Saves the prepared history data to the HISTORY_SHEET.
 */
function saveHistoryFromData(ss, historyToSave) {
    const sheet = ss.getSheetByName(HISTORY_SHEET);
    if (!sheet) {
        Logger.log(`Error: Sheet "${HISTORY_SHEET}" not found. Assignments not saved to history.`);
        return 0;
    }
    let savedCount = 0;
    historyToSave.forEach(h => {
        sheet.appendRow([
            h.weekStartDate,
            h.memberId,
            h.choreId,
            h.memberName,
            h.choreName,
            h.timestamp
        ]);
        savedCount++;
    });
    Logger.log(`Saved ${savedCount} assignments to ${HISTORY_SHEET}.`);
    return savedCount;
}

/**
 * Clears and updates the CURRENT_CHORES_SHEET with data for ALL active members.
 * Includes Chore Count column (Robyn's addition).
 */
function updateCurrentAssignmentsSheet(ss, outputRows, weekStartDateStr) {
    let sheet = ss.getSheetByName(CURRENT_CHORES_SHEET);
    if (!sheet) sheet = ss.insertSheet(CURRENT_CHORES_SHEET);

    sheet.clearContents().clearFormats();

    const headers = [
        "Member",
        "Chore / Status Note",
        "Chore Notes",
        "Week Of",
        "Chore Count"
    ];

    sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight("bold");

    sheet.setFrozenRows(1);

    const data = outputRows.map(row => [
        row.memberName,
        row.choreOrStatus,
        row.choreNotes,
        weekStartDateStr,
        row.choreCount
    ]);

    if (data.length > 0) {
        sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
        sheet.getRange(2, 5, data.length, 1).setNumberFormat("0");
        sheet.autoResizeColumns(1, headers.length);
    }
}


// ---- EMAIL NOTIFICATION ----
/**
 * Composes and sends email notifications for assigned chores.
 * Includes the chore submission website link.
 */
function sendEmailNotification(assignmentsToNotify, upcomingMondayDate) {
    const activeUserEmail = Session.getActiveUser().getEmail();
    const memberEmails = [...new Set(assignmentsToNotify.map(a => a.member.email).filter(email => email && email.includes('@') && email !== activeUserEmail))];

    if (!activeUserEmail && memberEmails.length === 0) {
        Logger.log("No valid recipient emails found for assigned chores. Email notification not sent.");
        return;
    }

    // Determine due dates and phrasing
  const today = new Date();
    const dayOfWeek = today.getDay();
    const upcomingSunday = new Date(upcomingMondayDate.getTime() - (1 * 24 * 60 * 60 * 1000));
    let dueDateText, checkTimeText, extensionDeadlineText, subjectDueDateStr;
    if (dayOfWeek === 5) {
        dueDateText = `this <strong>Sunday night (${formatDateWithOrdinal(upcomingSunday)})</strong>`;
        checkTimeText = "I'll check for completion first thing <strong>Monday morning</strong>.";
        extensionDeadlineText = "Need more time? <strong>Request an extension</strong> on the submission website by <strong>Saturday noon</strong>";
        subjectDueDateStr = `Sun, ${formatDateWithOrdinal(upcomingSunday)}`;
    } else {
        dueDateText = `this <strong>Monday noon (${formatDateWithOrdinal(upcomingMondayDate)})</strong>`;
        checkTimeText = "I will check for completion <strong>Monday afternoon</strong>.";
        extensionDeadlineText = "Need more time? <strong>Request an extension</strong> on the submission website, latest by <strong>Sunday noon</strong>.";
        subjectDueDateStr = `Mon, ${formatDateWithOrdinal(upcomingMondayDate)}`;
    }

    // Randomize messages
    const greetings = ["Hi everyone,", "Hey all,", "Hello housemates,", "Greetings everyone,", "Hi all,", "Hello all,"];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    const welcomeMessages = [
        "Hope you had a great week! Let's get ready for the next!",
        "Happy Weekend! Here are the upcoming chores to keep our space tidy.",
        "Hope you're relaxing! Just sending out the chore list for the week ahead.",
        "It's time for the weekly chore rundown. Thanks for pitching in!",
        "Wishing everyone a smooth start to the new week! Here are your chores:"
    ];
    const randomWelcome = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    const infoParagraphs = [
        `Here are this week's chore assignments below! Please aim to finish them by ${dueDateText}. ${checkTimeText} ${extensionDeadlineText} if you need a bit more time. Thanks!`,
        `Check out the chore list for the upcoming week. The deadline is ${dueDateText}. ${extensionDeadlineText}. ${checkTimeText}`,
        `Your mission, should you choose to accept it, is below. Chores are due ${dueDateText}. ${checkTimeText} ${extensionDeadlineText}.`,
        `Rolling out the chore assignments! Please have them wrapped up by ${dueDateText}. ${extensionDeadlineText}. ${checkTimeText} Appreciate everyone's help!`
    ];
    let randomInfo = infoParagraphs[Math.floor(Math.random() * infoParagraphs.length)];

    // Construct HTML Body
    let finalChoreInfo = `
    <p>${randomGreeting}</p>
    <p>${randomWelcome}</p>
    <p>${randomInfo}</p>
    <p><strong>Away for the weekend?</strong> If you've marked yourself as away on the dinner sign-up sheet, you don't need to request an extension separately and can complete your chore by Tuesday.</p>
    <p>You can find the task checklists on the side of the freezer in the kitchen and also <a href="${CHECKLIST_LINK}">here in the Google Doc</a>.</p>
    <div style="margin: 20px 0; padding: 16px 20px; background-color: #f0f4ff; border-left: 4px solid #4a6cf7; border-radius: 6px;">
      <p style="margin: 0 0 8px 0; font-weight: bold; font-size: 15px;">📱 Submit Your Chore Online</p>
      <p style="margin: 0 0 8px 0;">When you've completed your chore, submit it on the chore tracker website. You can also <strong>request an extension</strong> if you need more time.</p>
      <p style="margin: 0;"><a href="${CHORE_SUBMIT_URL}" style="display: inline-block; padding: 8px 20px; background-color: #4a6cf7; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Submit Your Chore →</a></p>
    </div>
    <p>Let me know if you have any questions! 😊</p>
    <hr>
  `;
    let htmlBody = `<html lang="en"><body style="font-family: sans-serif;">${finalChoreInfo}`;
    htmlBody += `<h2>${HOUSE_NAME} Chore Assignments (Due: ${subjectDueDateStr})</h2>`;
    htmlBody += `<table border="1" cellpadding="7" cellspacing="0" style="border-collapse: collapse; border: 1px solid #ccc;">
                 <thead style="background-color: #f2f2f2;"><tr><th>Member</th><th>Chore</th></tr></thead>
                 <tbody>`;
    assignmentsToNotify.forEach(a => {
        htmlBody += `<tr><td style="padding-right: 15px;">${a.member.name}</td><td>${a.chore.choreName}${a.chore.notes ? ` <i>(${a.chore.notes})</i>` : ''}</td></tr>`;
    });
    htmlBody += `</tbody></table><br>Thanks everyone!</body></html>`;

    const subject = `${HOUSE_NAME} Chore Assignments (Due: ${subjectDueDateStr})`;

  // Send email
    try {
        const emailOptions = {
            subject: subject,
            htmlBody: htmlBody
        };
        if (activeUserEmail && activeUserEmail.includes('@')) {
            emailOptions.to = activeUserEmail;
        }
        if (memberEmails.length > 0) {
            emailOptions.bcc = memberEmails.join(",");
        }
        if (emailOptions.to || emailOptions.bcc) {
          MailApp.sendEmail(emailOptions);
          Logger.log(`Email notification sent (To: ${emailOptions.to || 'None'}, BCC: ${memberEmails.length} members).`);
        } else {
           Logger.log("No valid TO or BCC recipients. Email not sent.");
        }
    } catch (e) {
        Logger.log("Error sending email notification: " + e);
    }
}


// ---- DISCORD NOTIFICATION ----
/**
 * Sends Discord notification for assigned chores.
 * Includes the chore submission website link.
 */
function sendDiscordNotification(assignmentsToNotify, upcomingMondayDate) {
    const webhookUrl = DISCORD_WEBHOOK_URL;
    if (!webhookUrl || webhookUrl === "YOUR_DISCORD_WEBHOOK_URL_HERE") {
        Logger.log("Discord Webhook URL is not configured. Skipping Discord notification.");
        return;
    }

    // Determine due dates and phrasing
    const today = new Date();
    const dayOfWeek = today.getDay();
    const upcomingSunday = new Date(upcomingMondayDate.getTime() - (1 * 24 * 60 * 60 * 1000));
    let dueDateTextDiscord, checkTimeTextDiscord, extensionDeadlineTextDiscord, subjectDueDateStrDiscord;
    if (dayOfWeek === 5) {
        dueDateTextDiscord = `due this **Sunday night (${formatDateWithOrdinal(upcomingSunday)})**`;
        checkTimeTextDiscord = "Completion check: **Monday morning**.";
        extensionDeadlineTextDiscord = "Need more time? Request an extension on the website by **Saturday noon**.";
        subjectDueDateStrDiscord = `Sun, ${formatDateWithOrdinal(upcomingSunday)}`;
    } else {
        dueDateTextDiscord = `due this **Monday noon (${formatDateWithOrdinal(upcomingMondayDate)})**`;
        checkTimeTextDiscord = "Completion check will be done by my underling* @house-manager*: **Monday afternoon**.";
        extensionDeadlineTextDiscord = "Need more time? Request an extension on the website by **Sunday noon**.";
        subjectDueDateStrDiscord = `Mon, ${formatDateWithOrdinal(upcomingMondayDate)}`;
    }

    // Funky Gorge Monster Intros
    const introMessages = [
        `I, the mighty Gorge Monster, have returned from the depths! Those who abide by my rule shall receive my blessings, but those who defy me will feel the full force of my wrath.`,
        `Tremble before the Gorge Monster! My hunger for cleanliness is insatiable. Fulfill these demands, lest you face the consequences!`,
        `The waters of the gorge churn, and from them, I emerge to judge your tidiness! Fail these tasks, and be banished to the murky depths!`,
        `Gorge Monster here! I'm watching you... keep the house clean or my vengeance will be swift and terrible.`,
        `Hear me, mortals! The Gorge Monster commands you to carry out these sacred duties. Disobey at your own peril!`
    ];
    const randomIntro = introMessages[Math.floor(Math.random() * introMessages.length)];

    // Construct Discord message
    let message = `${randomIntro}\n\n**${HOUSE_NAME} Chore Assignments (Due: ${subjectDueDateStrDiscord})**\n@everyone\n------------------------------------\n`;
    assignmentsToNotify.forEach(a => {
        message += `**${a.member.name}**: ${a.chore.choreName}${a.chore.notes ? ` (${a.chore.notes})` : ''}\n`;
    });
    message += `\n*Reminder: Chores ${dueDateTextDiscord}. \n${checkTimeTextDiscord} \n${extensionDeadlineTextDiscord} \nChecklists by freezer & in the `;
    message += `[Google Doc](${CHECKLIST_LINK}).*\n\n`;
    message += `📱 **Submit your completed chore & request extensions here:** ${CHORE_SUBMIT_URL}`;

  // Prepare payload and options
    const payload = JSON.stringify({ content: message });
    const options = {
        method: "post",
        contentType: "application/json",
        payload: payload,
        muteHttpExceptions: true
    };

   // Send to Discord
    try {
        const response = UrlFetchApp.fetch(webhookUrl, options);
        if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
            Logger.log("Discord notification sent successfully for assigned chores.");
        } else {
            Logger.log(`Discord webhook failed with response code ${response.getResponseCode()}: ${response.getContentText()}`);
        }
    } catch (e) {
        Logger.log("Error sending Discord notification: " + e);
    }
}


// ---- DATE & UTILITY HELPERS ----

/**
 * Calculates the date of the upcoming Monday (start of the week).
 */
function getUpcomingMonday() {
  const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToAdd = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    const upcomingMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToAdd);
    upcomingMonday.setHours(0, 0, 0, 0);
    return upcomingMonday;
}

/**
 * Formats a Date object into a string like "Apr 19th".
 */
function formatDateWithOrdinal(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        Logger.log("Invalid date passed to formatDateWithOrdinal");
        return "Invalid Date";
    }
    const day = date.getDate();
    let suffix;
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';
    else suffix = 'th';
    return Utilities.formatDate(date, Session.getScriptTimeZone(), `MMM d'${suffix}'`);
}


// ---- TRIGGER CREATION ----
/**
 * Creates or updates a time-driven trigger to run 'assignChores' automatically
 * every Sunday morning around 9 AM.
 */
function createWeeklyTrigger() {
    const functionName = 'assignChores';
    const triggers = ScriptApp.getProjectTriggers();
    let triggerDeleted = false;

    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(trigger);
            triggerDeleted = true;
            Logger.log(`Deleted existing trigger for ${functionName}.`);
        }
    });

    try {
        ScriptApp.newTrigger(functionName)
            .timeBased()
            .onWeekDay(ScriptApp.WeekDay.SUNDAY)
            .atHour(9)
            .inTimezone(Session.getScriptTimeZone())
            .create();

        const message = triggerDeleted
            ? `Existing trigger for '${functionName}' deleted. New weekly trigger created successfully to run every Sunday around 9 AM.`
            : `New weekly trigger created successfully for '${functionName}' to run every Sunday around 9 AM.`;
        SpreadsheetApp.getUi().alert(message);
        Logger.log(`Created new weekly trigger for ${functionName}.`);
    } catch (e) {
        Logger.log("Error creating weekly trigger: " + e);
        SpreadsheetApp.getUi().alert("Error creating weekly trigger. Make sure you have permissions. Check Logs.");
    }
}
