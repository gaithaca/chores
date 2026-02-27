// ---- CONFIGURATION ----
const CHORES_SHEET = "Chores";
const MEMBERS_SHEET = "Members";
const HISTORY_SHEET = "History";
const AVAIL_SHEET = "Availability";
const CURRENT_CHORES_SHEET = "Current Assignments";
// Using the provided webhook URL from search result [1]
const DISCORD_WEBHOOK_URL = "";
// Using the provided house name from search result [1]
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
    .addSeparator()
    .addItem('Create/Update Weekly Trigger', 'createWeeklyTrigger')
    .addSeparator()
    .addItem('Seed Subtasks (one-time)', 'seedSubtasks')
    .addToUi();
}


// ---- CHORE ASSIGNMENT ----
/**
 * Main function to assign chores based on availability, history, and importance.
 * Populates 'Current Assignments' but DOES NOT log to 'History' sheet.
 */
// Changes:
//   1. Global bipartite matching (not sequential per-chore)
//   2. Histogram-based scoring for uniform distribution
//   3. Only 1-week exclusion (not 2 weeks)
//   4. Importance still prioritized (via score bonus)
// =====================================================


/**
 * Main function to assign chores using histogram-based global matching.
 * Builds a full count matrix from ALL history, scores every eligible
 * (member, chore) pair, then greedily assigns the best matches.
 *
 * Important chores still get priority via a score bonus, ensuring
 * they are always assigned first.
 */
function assignChores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allChores = getChores(ss);
  const allActiveMembers = getActiveMembers(ss);
  const upcomingMonday = getUpcomingMonday();
  const upcomingMondayStr = Utilities.formatDate(upcomingMonday, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const availabilityData = getAvailability(ss, upcomingMondayStr);

  // ── 1. Build full histogram from ALL history ──
  const allHistory = getHistory(ss, 0);
  const choreCounts = {};  // choreCounts[memberId][choreId] = count
  const totalCounts = {};  // totalCounts[memberId] = total chores done

  // Initialize for all active members
  allActiveMembers.forEach(m => {
    choreCounts[m.id] = {};
    totalCounts[m.id] = 0;
  });

  allHistory.forEach(h => {
    if (!choreCounts[h.memberId]) choreCounts[h.memberId] = {};
    if (!choreCounts[h.memberId][h.choreId]) choreCounts[h.memberId][h.choreId] = 0;
    choreCounts[h.memberId][h.choreId]++;
    if (!totalCounts[h.memberId]) totalCounts[h.memberId] = 0;
    totalCounts[h.memberId]++;
  });

  // ── 2. Get LAST WEEK only for exclusion ──
  const lastWeekHistory = getHistory(ss, 1);
  const lastWeekChore = {};  // lastWeekChore[memberId] = choreId
  lastWeekHistory.forEach(h => {
    lastWeekChore[h.memberId] = h.choreId;
  });

  // ── 3. Availability lookup ──
  const availMap = {};
  availabilityData.forEach(av => {
    availMap[av.memberId] = { status: av.available, notes: av.notes };
  });

  // Eligible members = available and (Active or Visitor)
  const eligibleMembers = allActiveMembers.filter(member => {
    const memberAvail = availMap[member.id];
    return memberAvail && (memberAvail.status === "Yes" || memberAvail.status === "Yes (No Sunday)");
  });

  // ── 4. Importance bonus mapping ──
  function importanceBonus(chore) {
    const imp = chore.importance.toLowerCase();
    if (imp === "imp") return 30;
    if (imp === "2nd imp") return 20;
    if (imp === "3rd imp") return 10;
    return 0;
  }

  // ── 5. Build scored (member, chore) candidates ──
  const candidates = [];

  eligibleMembers.forEach(member => {
    const memberAvail = availMap[member.id];

    allChores.forEach(chore => {
      // Hard exclude: member did this exact chore LAST WEEK
      if (String(lastWeekChore[member.id]) === String(chore.id)) return;

      // Sunday restriction
      if (chore.choreName.toUpperCase().includes("SUNDAY") &&
          memberAvail.status === "Yes (No Sunday)") return;

      // ── SCORE FORMULA ──
      const choreCount = (choreCounts[member.id][chore.id]) || 0;
      const total = totalCounts[member.id] || 0;

      const score = -choreCount * 10000
                    - total * 100
                    + importanceBonus(chore)
                    + Math.random();

      candidates.push({
        member: member,
        chore: chore,
        score: score,
        choreCount: choreCount,
        totalCount: total
      });
    });
  });

  // ── 6. Sort by score descending (best matches first) ──
  candidates.sort((a, b) => b.score - a.score);

  // ── 7. Greedy bipartite matching ──
  const assignments = [];
  const assignedMemberIds = new Set();
  const assignedChoreIds = new Set();

  candidates.forEach(cand => {
    if (assignedMemberIds.has(cand.member.id)) return;
    if (assignedChoreIds.has(cand.chore.id)) return;

    assignments.push({ chore: cand.chore, member: cand.member });
    assignedMemberIds.add(cand.member.id);
    assignedChoreIds.add(cand.chore.id);
  });

  // ── 8. Build output for ALL active members ──
  const outputRows = [];
  allActiveMembers.forEach(member => {
    const assignmentInfo = assignments.find(a => a.member.id == member.id);
    const memberAvail = availMap[member.id];

    if (assignmentInfo) {
      outputRows.push({
        memberName: member.name,
        choreOrStatus: assignmentInfo.chore.choreName,
        choreNotes: assignmentInfo.chore.notes || ""
      });
    } else {
      let statusNote = "Available, No Chore Assigned";
      if (memberAvail) {
        if (memberAvail.status === "No") {
          statusNote = memberAvail.notes || "Unavailable (No specific note)";
        } else if (memberAvail.status !== "Yes" && memberAvail.status !== "Yes (No Sunday)") {
          statusNote = `Status: ${memberAvail.status}` + (memberAvail.notes ? ` (${memberAvail.notes})` : "");
        }
      } else {
        statusNote = "Availability Not Provided";
      }
      outputRows.push({
        memberName: member.name,
        choreOrStatus: statusNote,
        choreNotes: ""
      });
    }
  });

  outputRows.sort((a, b) => a.memberName.localeCompare(b.memberName));

  // ── 9. Update sheet & alert ──
  if (outputRows.length > 0) {
    updateCurrentAssignmentsSheet(ss, outputRows, upcomingMondayStr);
    const assignedCount = assignments.length;
    const totalMembers = allActiveMembers.length;
    SpreadsheetApp.getUi().alert(
      `Assignments processed for week starting ${upcomingMondayStr}!\n\n` +
      `${assignedCount} chores assigned out of ${allChores.length} chores and ${totalMembers} active members.\n\n` +
      `Review in '${CURRENT_CHORES_SHEET}', then run 'Send Notifications & Log History' when ready.`
    );
  } else {
    SpreadsheetApp.getUi().alert(
      `No active members found or no assignments could be made for week starting ${upcomingMondayStr}. ` +
      `Check Members, Availability, and Chores sheets.`
    );
  }
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

  const weekOfStr = data[1][3] ? String(data[1][3]).trim() : "";
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

  // --- Log to History Sheet ---
  let historySavedCount = 0;
  if (historyToSave.length > 0) {
    historySavedCount = saveHistoryFromData(ss, historyToSave);
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


// ---- DATA FETCHING HELPERS ----
/**
 * Fetches chore details. Returns ID, Name, Importance, Notes.
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
 * Fetches active/visitor member details. Returns ID, Name, Email, Status, Notes.
 */
function getActiveMembers(ss) {
  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) { Logger.log(`Error: Sheet "${MEMBERS_SHEET}" not found.`); return []; }
  const data = sheet.getDataRange().getValues();
  return data.slice(1).map(row => ({
    id: String(row[0]).trim(),
    name: String(row[1]).trim(),
    email: String(row[2]).trim(),
    status: String(row[3]).trim(),
    notes: row[4] || ""
  })).filter(m => m.id && m.name && m.email && (m.status === "Active" || m.status === "Visitor"));
}

/**
 * Fetches availability data for a specific week start date string (yyyy-MM-dd).
 */
function getAvailability(ss, weekStartDateStr) {
  const sheet = ss.getSheetByName(AVAIL_SHEET);
  if (!sheet) { Logger.log(`Error: Sheet "${AVAIL_SHEET}" not found.`); return []; }
  const data = sheet.getDataRange().getValues();
  const results = [];
  data.slice(1).forEach(row => {
    let sheetDateStr = "";
    const dateValue = row[0];
    const memberId = String(row[1]).trim();
    const availableStatus = String(row[2]).trim();
    const notes = row[3] || "";
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        sheetDateStr = Utilities.formatDate(dateValue, Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
        try {
            let parsedDate = new Date(dateValue);
            if (!isNaN(parsedDate.getTime())) {
                sheetDateStr = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
            }
        } catch (e) { Logger.log(`Could not parse date value: ${dateValue} in ${AVAIL_SHEET}`); }
    }
    if (sheetDateStr === weekStartDateStr && memberId) {
      results.push({
        weekStartDate: sheetDateStr,
        memberId: memberId,
        available: availableStatus,
        notes: notes
      });
    }
  });
  return results;
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
 */
function updateCurrentAssignmentsSheet(ss, outputRows, weekStartDateStr) {
  let sheet = ss.getSheetByName(CURRENT_CHORES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CURRENT_CHORES_SHEET);
    Logger.log(`Sheet "${CURRENT_CHORES_SHEET}" created.`);
  }
  sheet.clearContents().clearFormats();
  const headers = ["Member", "Chore / Status Note", "Chore Notes", "Week Of"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  const data = outputRows.map(row => [
    row.memberName,
    row.choreOrStatus,
    row.choreNotes,
    weekStartDateStr
  ]);
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
    sheet.autoResizeColumns(1, headers.length);
  } else {
    sheet.getRange(2, 1).setValue("No member data processed for this week.");
  }
   Logger.log(`Updated ${CURRENT_CHORES_SHEET} with ${outputRows.length} member entries.`);
}


// ---- EMAIL NOTIFICATION ----
/**
 * Composes and sends email notifications for assigned chores.
 * Now includes the chore submission website link.
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
 * Now includes the chore submission website link.
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

  // Construct Discord message
  let message = `I, the mighty Gorge Monster, have been called forth once again. Those who abide by my rule shall receive my blessings, but those who defy me will feel the full force of my wrath. Here are my commands for this week \n **${HOUSE_NAME} Chore Assignments (Due: ${subjectDueDateStrDiscord})** \n@everyone\n------------------------------------\n`;
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
 * Finds the best member to assign a chore to from a list of eligible members.
 */
function findBestMemberForChore(eligibleMembers, chore, choreCounts) {
  if (eligibleMembers.length === 1) {
    return eligibleMembers[0];
  }

  const scoredMembers = eligibleMembers.map(member => {
    let count = 0;
    if (choreCounts[member.id] && choreCounts[member.id][chore.id]) {
      count = choreCounts[member.id][chore.id];
    }
    return { member: member, count: count };
  });

  scoredMembers.sort((a, b) => a.count - b.count);
  const lowestCount = scoredMembers[0].count;
  const bestMembers = scoredMembers
    .filter(m => m.count === lowestCount)
    .map(m => m.member);
  const chosenMember = bestMembers[Math.floor(Math.random() * bestMembers.length)];
  return chosenMember;
}


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
