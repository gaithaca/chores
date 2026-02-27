/**
 * ═══════════════════════════════════════════════════════════════
 *  Gamma Alpha Chore Tracker — Web App API
 *  Paste this file alongside your existing Code.gs in Apps Script.
 * ═══════════════════════════════════════════════════════════════
 *
 * SETUP:
 * 1. In your Google Sheet, create 3 new tabs:
 *    - "Subtasks"    → headers: chore_id | subtask_text
 *    - "Submissions"  → headers: id | net_id | chore_id | subtasks_checked_json | submitted_at | cycle_id | is_late | note
 *    - "Extensions"   → headers: id | net_id | cycle_id | extended_deadline | granted_by | granted_at | reason
 *
 * 2. In your "Members" sheet, add column F with header "role".
 *    Set the value to "house_manager" for the House Manager.
 *    Leave blank or "resident" for everyone else.
 *
 * 3. Run the "seedSubtasks" function from the menu (Chore Tools → Seed Subtasks)
 *    to populate the Subtasks sheet with all chore subtask data.
 *
 * 4. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    Copy the URL into app.js
 *
 * NOTE: This file references constants from your existing Code.gs:
 *   CHORES_SHEET, MEMBERS_SHEET, CURRENT_CHORES_SHEET
 */

// ─── New Sheet Names ──────────────────────────────────

const SUBTASKS_SHEET_NAME = "Subtasks";
const SUBMISSIONS_SHEET_NAME = "Submissions";
const EXTENSIONS_SHEET_NAME = "Extensions";

// ─── Add to custom menu ──────────────────────────────

function onOpen_WebApp() {
  // Call this from your existing onOpen or manually add to your menu:
  // .addItem('Seed Subtasks', 'seedSubtasks')
  // For convenience, we extend the existing menu:
  try {
    SpreadsheetApp.getUi()
      .createMenu('Chore Tracker')
      .addItem('Seed Subtasks (one-time)', 'seedSubtasks')
      .addToUi();
  } catch (e) {
    Logger.log('Menu creation deferred: ' + e);
  }
}

// ─── GET Handler ──────────────────────────────────────

function doGet(e) {
  try {
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      case 'getMembers':
        return apiJsonResponse({ success: true, data: fetchMembers_(ss) });

      case 'getChores':
        return apiJsonResponse({ success: true, data: fetchChoresWithSubtasks_(ss) });

      case 'getAssignments':
        return apiJsonResponse({ success: true, data: fetchAssignments_(ss, e.parameter.cycle_id) });

      case 'getSubmissions': {
        const subs = fetchSheetRows_(ss, SUBMISSIONS_SHEET_NAME);
        const cycleId = e.parameter.cycle_id;
        const filtered = cycleId
          ? subs.filter(s => normalizeCycleId_(s.cycle_id) === normalizeCycleId_(cycleId))
          : subs;
        return apiJsonResponse({ success: true, data: filtered });
      }

      case 'getExtensions': {
        const exts = fetchSheetRows_(ss, EXTENSIONS_SHEET_NAME);
        const cycleId = e.parameter.cycle_id;
        const filtered = cycleId
          ? exts.filter(ex => normalizeCycleId_(ex.cycle_id) === normalizeCycleId_(cycleId))
          : exts;
        return apiJsonResponse({ success: true, data: filtered });
      }

      case 'getCycleInfo':
        return apiJsonResponse({ success: true, data: computeCycleInfo_(ss) });

      default:
        return apiJsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return apiJsonResponse({ success: false, error: err.toString() });
  }
}

// ─── POST Handler ─────────────────────────────────────

// ─── Discord Webhook ──────────────────────────────────
// Set this to your Discord channel's webhook URL
const DISCORD_WEBHOOK_URL = '';        // e.g. 'https://discord.com/api/webhooks/...'

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      case 'submitChore':
        return apiJsonResponse({ success: true, data: handleSubmitChore_(ss, body) });

      case 'grantExtension':
        return apiJsonResponse({ success: true, data: handleGrantExtension_(ss, body) });

      case 'verifyManager':
        return apiJsonResponse(verifyManager_(ss, body));

      case 'sendFine':
        return apiJsonResponse(handleSendFine_(ss, body));

      default:
        return apiJsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return apiJsonResponse({ success: false, error: err.toString() });
  }
}

// ─── Response Helper ──────────────────────────────────

function apiJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Normalizes a cycle_id to just "yyyy-MM-dd".
 */
function normalizeCycleId_(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : str;
}

// ─── Data Fetchers ────────────────────────────────────

/**
 * Reads Members sheet → returns [{net_id, name, email, status, role}]
 * Column layout: A=net_id, B=name, C=email, D=status, E=?, F=role, G=password, H=discord_id
 * NOTE: password and discord_id are intentionally NOT included in API response
 */
function fetchMembers_(ss) {
  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  return data.slice(1).map(row => {
    const id = String(row[0]).trim();
    const name = String(row[1]).trim();
    const email = String(row[2]).trim();
    const status = String(row[3]).trim();
    const role = row.length > 5 && String(row[5]).trim().toLowerCase() === 'house_manager'
      ? 'house_manager' : 'resident';
    return { net_id: id, name: name, email: email, status: status, role: role };
  }).filter(m => m.net_id && m.name && (m.status === 'Active' || m.status === 'Visitor'));
}

/**
 * Looks up a member's Discord ID from column H (index 7) of the Members sheet.
 */
function getDiscordId_(ss, netId) {
  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === netId.toLowerCase()) {
      return data[i].length > 7 ? String(data[i][7]).trim() : '';
    }
  }
  return '';
}

/**
 * Looks up the Discord ID for the member with role='treasurer' in the Members sheet.
 */
function getTreasurerDiscordId_(ss) {
  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const role = data[i].length > 5 ? String(data[i][5]).trim().toLowerCase() : '';
    if (role === 'treasurer') {
      return data[i].length > 7 ? String(data[i][7]).trim() : '';
    }
  }
  return '';
}

/**
 * Sends a fine notification via Discord webhook (with @mentions) and records it.
 * @mentions the fined member + treasurer using their Discord IDs.
 * Members sheet column H = discord_id.
 */
function handleSendFine_(ss, body) {
  const netId = String(body.net_id || '').trim();
  const memberName = String(body.member_name || '').trim();
  const choreName = String(body.chore_name || '').trim();
  const fineAmount = body.fine_amount || 40;
  const cycleId = body.cycle_id || '';
  const grantedBy = body.granted_by || '';

  if (!netId || !memberName) {
    return { success: false, error: 'Missing net_id or member_name.' };
  }

  // Look up Discord IDs from the sheet
  const memberDiscordId = getDiscordId_(ss, netId);
  const treasurerDiscordId = getTreasurerDiscordId_(ss);

  // Send Discord notification with @mentions
  if (DISCORD_WEBHOOK_URL) {
    // Build @mention pings
    const mentions = [];
    if (memberDiscordId) mentions.push(`<@${memberDiscordId}>`);
    if (treasurerDiscordId) mentions.push(`<@${treasurerDiscordId}>`);
    const pingLine = mentions.length > 0 ? mentions.join(' ') : '';

    const payload = {
      content: pingLine,  // @mentions appear above the embed and trigger notifications
      embeds: [{
        title: '💸 Chore Fine — $' + fineAmount,
        color: 0xEF4444,
        description: `**${memberName}** (${netId}) has been fined for not completing their chore.`,
        fields: [
          { name: 'Chore', value: choreName || 'N/A', inline: true },
          { name: 'Fine Amount', value: `$${fineAmount}`, inline: true },
          { name: 'Week Of', value: cycleId || 'N/A', inline: true },
          { name: 'Issued By', value: grantedBy || 'House Manager', inline: true }
        ],
        footer: { text: 'ΓΑ Chore Tracker' },
        timestamp: new Date().toISOString()
      }],
      allowed_mentions: { users: [memberDiscordId, treasurerDiscordId].filter(Boolean) }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
    if (response.getResponseCode() >= 400) {
      return { success: false, error: 'Discord webhook failed: ' + response.getContentText() };
    }
  }

  // Record the fine in the Fines sheet (create if needed)
  let finesSheet = ss.getSheetByName('Fines');
  if (!finesSheet) {
    finesSheet = ss.insertSheet('Fines');
    finesSheet.appendRow(['id', 'net_id', 'member_name', 'chore_name', 'fine_amount', 'cycle_id', 'granted_by', 'sent_at']);
  }

  const fineId = Utilities.getUuid();
  finesSheet.appendRow([
    fineId, netId, memberName, choreName, fineAmount, cycleId, grantedBy, new Date().toISOString()
  ]);

  return { success: true, data: { id: fineId, discord_sent: !!DISCORD_WEBHOOK_URL } };
}

/**
 * Verifies manager credentials. Reads password from column G of the Members sheet.
 */
function verifyManager_(ss, body) {
  const netId = String(body.net_id || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!netId || !password) {
    return { success: false, error: 'Net ID and password are required.' };
  }

  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return { success: false, error: 'Members sheet not found.' };
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][0]).trim().toLowerCase();
    const role = data[i].length > 5 ? String(data[i][5]).trim().toLowerCase() : '';
    const storedPw = data[i].length > 6 ? String(data[i][6]).trim() : '';

    if (rowId === netId) {
      if (role !== 'house_manager') {
        return { success: false, error: 'This account does not have manager access.' };
      }
      if (!storedPw) {
        return { success: false, error: 'No password set for this account. Add one in column G of the Members sheet.' };
      }
      if (storedPw === password) {
        return { success: true };
      } else {
        return { success: false, error: 'Incorrect password.' };
      }
    }
  }
  return { success: false, error: 'Net ID not found.' };
}

/**
 * Reads Chores + Subtasks sheets → returns [{chore_id, name, notes, subtasks: [...]}]
 */
function fetchChoresWithSubtasks_(ss) {
  // Read chores from existing CHORES_SHEET
  const choreSheet = ss.getSheetByName(CHORES_SHEET);
  if (!choreSheet) return [];
  const choreData = choreSheet.getDataRange().getValues();

  const chores = choreData.slice(1).map(row => ({
    chore_id: String(row[0]).trim(),
    name: String(row[1]).trim(),
    importance: String(row[2]).trim(),
    notes: row[3] ? String(row[3]) : '',
    subtasks: []
  })).filter(c => c.chore_id && c.name);

  // Read subtasks from Subtasks sheet and attach to chores
  const subtaskSheet = ss.getSheetByName(SUBTASKS_SHEET_NAME);
  if (subtaskSheet) {
    const subtaskData = subtaskSheet.getDataRange().getValues();
    subtaskData.slice(1).forEach(row => {
      const choreId = String(row[0]).trim();
      const text = String(row[2]).trim(); // Column C (index 2) = subtask_text
      if (choreId && text) {
        const chore = chores.find(c => c.chore_id === choreId);
        if (chore) chore.subtasks.push(text);
      }
    });
  }

  return chores;
}

/**
 * Reads Current Assignments sheet → returns [{cycle_id, net_id, chore_id, member_name, chore_name}]
 * Cross-references Members and Chores sheets to resolve IDs.
 */
function fetchAssignments_(ss, cycleId) {
  const sheet = ss.getSheetByName(CURRENT_CHORES_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // Build name→ID lookup maps
  const members = fetchMembers_(ss);
  const chores = fetchChoresWithSubtasks_(ss);
  const memberByName = {};
  members.forEach(m => { memberByName[m.name] = m; });
  const choreByName = {};
  chores.forEach(c => { choreByName[c.name] = c; });

  // Read "Week Of" from column D, row 2
  let weekOf = '';
  const rawWeekOf = data[1][3];
  if (rawWeekOf instanceof Date && !isNaN(rawWeekOf.getTime())) {
    weekOf = Utilities.formatDate(rawWeekOf, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } else if (rawWeekOf) {
    weekOf = String(rawWeekOf).trim();
  }

  // If a specific cycle was requested and it doesn't match, return empty
  if (cycleId && weekOf && cycleId !== weekOf) {
    return [];
  }

  const assignments = [];
  const statusKeywords = ["UNAVAILABLE", "AVAILABILITY NOT PROVIDED", "NO CHORE ASSIGNED", "STATUS:"];

  for (let i = 1; i < data.length; i++) {
    const memberName = String(data[i][0]).trim();
    const choreOrStatus = String(data[i][1]).trim();

    // Skip status note rows
    const isStatus = statusKeywords.some(kw => choreOrStatus.toUpperCase().includes(kw));
    if (!memberName || !choreOrStatus || isStatus) continue;

    const member = memberByName[memberName];
    const chore = choreByName[choreOrStatus];
    if (member && chore) {
      assignments.push({
        cycle_id: weekOf,
        net_id: member.net_id,
        chore_id: chore.chore_id,
        member_name: member.name,
        chore_name: chore.name
      });
    }
  }

  return assignments;
}

/**
 * Generic helper: reads any sheet into an array of objects using row 1 as headers.
 */
function fetchSheetRows_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      // Google Sheets auto-converts date-like strings to Date objects.
      // Normalize them back to strings so filtering/comparisons work.
      if (val instanceof Date && !isNaN(val.getTime())) {
        // Date-only columns (cycle_id) → yyyy-MM-dd
        // Datetime columns (submitted_at, extended_deadline, granted_at) → ISO string
        if (h === 'cycle_id') {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else {
          val = val.toISOString();
        }
      }
      obj[h] = val;
    });
    return obj;
  });
}

/**
 * Returns current cycle info: {cycle_id, deadline, now}
 * cycle_id = the "Week Of" date from Current Assignments (yyyy-MM-dd)
 * deadline = that date + 7 days, 8:00 AM (next Monday morning)
 */
function computeCycleInfo_(ss) {
  const now = new Date();

  // Try reading "Week Of" from Current Assignments sheet
  const sheet = ss.getSheetByName(CURRENT_CHORES_SHEET);
  let assignmentWeek = '';

  if (sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const rawVal = data[1][3]; // Column D, row 2
      if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
        assignmentWeek = Utilities.formatDate(rawVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else if (rawVal) {
        assignmentWeek = String(rawVal).trim();
      }
    }
  }

  // Fallback: compute current Monday
  if (!assignmentWeek) {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    assignmentWeek = Utilities.formatDate(monday, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  // Deadline = "Week Of" date at 8:00 AM
  const weekOfDate = new Date(assignmentWeek + "T00:00:00");
  const deadlineDate = new Date(weekOfDate);
  deadlineDate.setHours(8, 0, 0, 0);

  return {
    cycle_id: assignmentWeek,
    deadline: deadlineDate.toISOString(),
    now: now.toISOString()
  };
}

// ─── POST Action Handlers ─────────────────────────────

function handleSubmitChore_(ss, body) {
  const sheet = ss.getSheetByName(SUBMISSIONS_SHEET_NAME);
  if (!sheet) throw new Error("'" + SUBMISSIONS_SHEET_NAME + "' sheet not found. Please create it with headers: id | net_id | chore_id | subtasks_checked_json | submitted_at | cycle_id | is_late | note");

  const now = new Date();
  const cycleId = body.cycle_id;

  // Compute deadline — same as the week-of date at 8 AM
  const weekOfDate = new Date(cycleId + "T00:00:00");
  const deadline = new Date(weekOfDate);
  deadline.setHours(8, 0, 0, 0);

  // Check if late
  let isLate = 0;
  if (now > deadline) {
    isLate = 1;
    // Check for an active extension
    const extSheet = ss.getSheetByName(EXTENSIONS_SHEET_NAME);
    if (extSheet) {
      const extData = extSheet.getDataRange().getValues();
      for (let i = 1; i < extData.length; i++) {
        if (String(extData[i][1]).trim() === body.net_id &&
            String(extData[i][2]).trim() === cycleId) {
          const extDeadline = new Date(extData[i][3]);
          if (!isNaN(extDeadline.getTime()) && extDeadline > now) {
            isLate = 0;
            break;
          }
        }
      }
    }
  }

  // Generate next ID
  const data = sheet.getDataRange().getValues();
  const ids = data.slice(1).map(r => parseInt(r[0]) || 0);
  const id = ids.length > 0 ? Math.max(...ids) + 1 : 1;

  const submittedAt = now.toISOString();
  const subtasksJson = JSON.stringify(body.subtasks_checked);
  const note = body.note || '';

  sheet.appendRow([id, body.net_id, body.chore_id, subtasksJson, submittedAt, cycleId, isLate, note]);

  return {
    id: id,
    net_id: body.net_id,
    chore_id: body.chore_id,
    subtasks_checked: body.subtasks_checked,
    submitted_at: submittedAt,
    cycle_id: cycleId,
    is_late: isLate,
    note: note
  };
}

function handleGrantExtension_(ss, body) {
  const sheet = ss.getSheetByName(EXTENSIONS_SHEET_NAME);
  if (!sheet) throw new Error("'" + EXTENSIONS_SHEET_NAME + "' sheet not found.");

  const now = new Date();
  const data = sheet.getDataRange().getValues();
  const ids = data.slice(1).map(r => parseInt(r[0]) || 0);
  const id = ids.length > 0 ? Math.max(...ids) + 1 : 1;

  sheet.appendRow([
    id,
    body.net_id,
    body.cycle_id,
    body.extended_deadline,
    body.granted_by,
    now.toISOString(),
    body.reason || ''
  ]);

  return {
    id: id,
    net_id: body.net_id,
    cycle_id: body.cycle_id,
    extended_deadline: body.extended_deadline,
    granted_by: body.granted_by,
    granted_at: now.toISOString(),
    reason: body.reason || ''
  };
}

// ─── Seed Subtasks ────────────────────────────────────
/**
 * One-time function to populate the Subtasks sheet with all chore subtask data.
 * Matches chore IDs by looking up chore names in the existing Chores sheet.
 * Run from: Chore Tracker menu → "Seed Subtasks (one-time)"
 */
function seedSubtasks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Get existing chores to map names → IDs
  const choreSheet = ss.getSheetByName(CHORES_SHEET);
  if (!choreSheet) {
    SpreadsheetApp.getUi().alert('Chores sheet not found. Please create the "' + CHORES_SHEET + '" sheet first.');
    return;
  }
  const choreData = choreSheet.getDataRange().getValues();
  const choreMap = {}; // lowercase name → id
  choreData.slice(1).forEach(row => {
    const id = String(row[0]).trim();
    const name = String(row[1]).trim().toLowerCase();
    if (id && name) choreMap[name] = id;
  });

  // All subtask data keyed by chore name (case-insensitive matching)
  const subtasksByChore = {
    "flex chore": [
      "Oil the butcher block table with mineral oil from the dining room closet.",
      "Scrub all parts of the stovetop and the front of the ovens (see posted stove care info).",
      "Remove two of the racks from the fridge and wash the racks and the inside of the fridge with soap and water.",
      "Take trash cans outside, add vinegar and water, scrub the inside with a brush/broom. Pour dirty water on the street and leave cans upside-down to dry.",
      "Scrape out and bag up loose trash at the bottom of outdoor garbage bins. Wash two of the dirtiest bins with the hose outside. Let dry and return.",
      "From November to April (or whenever heat is on), drain sediment from the furnace. Sign the boiler log in the basement with the date."
    ],
    "chefs - cooking dinner": [
      "After dinner, run the dishwasher.",
      "Check that the garbage disposal is not clogged by running it with flowing cold water from the faucet.",
      "Clean the drain and the edges where the dishwasher closes, removing gunk from the corners and the seals.",
      "Arrange the dishwasher so that dishes do not block the water flow.",
      "Refill rinse-aid compartment with vinegar or rinse-aid.",
      "Wood, non-stick or other delicate dishes should be washed by hand only!",
      "Plastic containers are only washed on the top shelf. If plastic is to be washed, turn off 'dry heat'."
    ],
    "first floor bathroom": [
      "Scrub the toilet including outside the fixture, under the lip, and area where water drains. (Use toilet bowl cleaner)",
      "Clean the sink including the drain. (Use lysol/bleach or any disinfectant)",
      "Use a brush to scrub and clean the faucet.",
      "Clean the mirror.",
      "Restock toilet paper and refill soap dispensers.",
      "Sweep and then scrub or mop the floor with Mr. Clean multipurpose cleaner. Use mop marked 'bathroom'. Return mop and bucket to dining room supply closet.",
      "Collect towels from all three bathrooms. Wash towels in 95°C water. When dry, fold and return them to the bathrooms.",
      "Collect dirty bath mats from upstairs. Wash in knits/gentle cycle with no bleach and almost no detergent. Hang to dry on basement drying racks. Replace bath mats in east and west bathrooms."
    ],
    "west (small) bathroom": [
      "Scrub the shower stall including walls, metal parts, floor, and toiletry shelves. Remove mold using diluted bleach and Bon Ami.",
      "Scrub the toilet including outside the fixture, under the lip, and area where water drains. (Use toilet bowl cleaner)",
      "Clean the sink including the drain. (Use lysol/bleach or any disinfectant)",
      "Use a brush to scrub and clean the faucet.",
      "Clean the mirror.",
      "Restock toilet paper.",
      "Refill soap dispensers.",
      "Sweep and then mop the floor with Mr. Clean multipurpose cleaner (use mop marked 'bathroom'). Return mop and bucket to dining room supply closet.",
      "Remove spider webs from corners (including ceiling)."
    ],
    "east (large) bathroom": [
      "Scrub the shower stall including walls, metal parts, floor, under the ledge, and toiletry shelves. Remove mold using diluted bleach and Bon Ami.",
      "Scrub the toilet including outside the fixture, under the lip, and area where water drains. (Use toilet bowl cleaner)",
      "Clean the sink including the drain. (Use lysol/bleach or any disinfectant)",
      "Use a brush to scrub and clean the faucet.",
      "Clean the mirror.",
      "Restock toilet paper.",
      "Refill soap dispensers.",
      "Sweep and then mop the floor with Mr. Clean multipurpose cleaner (use mop marked 'bathroom'). Return mop and bucket to dining room supply closet.",
      "Remove spider webs from corners (including ceiling)."
    ],
    "lawn, sidewalk and porch/compost": [
      "In Winter (Nov–Feb): Shovel snow from the sidewalk as needed (within 1 day of each snowfall by city ordinance).",
      "Other Seasons: Rake leaves.",
      "Mow the lawn (the city can issue a ticket if the grass exceeds 9 inches).",
      "Clean up trash from the lawn and the front entrance.",
      "Keep the front yard neat, removing weeds and trimming overgrowth.",
      "(If compost is active) Turn the compost piles, adding leaves, lime, or other material to balance the vegetable matter.",
      "Tidy the porch and external appearance of the house: sweep, wipe and arrange chairs, tables, etc."
    ],
    "front rooms": [
      "Vacuum the big carpet in the foyer.",
      "Sweep or vacuum the floor and mop all floors. Use mop labeled 'wood'.",
      "Clean the window in the door to the entry room.",
      "Clean the table tops and straighten as needed.",
      "Vacuum spider webs from all walls and corners (including near the ceiling).",
      "Clean dust from the piano and all tables and surfaces in the four rooms.",
      "Straighten and vacuum the front entrance area."
    ],
    "hallways & entry room": [
      "Check the vacuum bag to see if it is ripped or full and charge it as needed.",
      "Sweep the front and back stairwells including the basement stairwell.",
      "Sweep the 2nd floor and 3rd floor hallways (use a damp mop or rag for dirty/dusty spots).",
      "Vacuum the front stairs and the 2nd floor hallway.",
      "Take rugs from the entry room outside and shake them out to remove debris.",
      "Remove all rugs, shoes, and furniture from the entry room. Sweep/Vacuum and Mop (use mop labeled 'Wood'). Allow floor to dry and return all furniture.",
      "Dust the stair railings and windowsills.",
      "Check and change the lint filter on the basement sink if clogged.",
      "Clean the top of the washing machine and the dryer.",
      "Clean/straighten the laundry area."
    ],
    "kitchen": [
      "Sweep the kitchen floors, including under the table, recycling area, and under both sinks.",
      "Mop the kitchen floors with very hot water and Mr. Clean multipurpose cleaner (use mop labeled 'Kitchen').",
      "Collect oven mitts and return to where they belong.",
      "Wash the serving and dining tables in the dining room with soap/vinegar.",
      "Turn chairs/stools up on the table to sweep the dining room floors, including under all tables.",
      "Mop the dining room floors with warm water and Murphy's oil soap (use mop labeled 'wood').",
      "Put the chairs/stools back down after mopping the dining room and kitchen."
    ],
    "sinks and towels (mix #1)": [
      "(If compost is active) Empty the compost bucket from the kitchen.",
      "(If compost is active) Wash the compost bucket with soap/bleach and water.",
      "(If compost is active) Wash the wall behind the compost bucket in the blue kitchen.",
      "Collect all towels and dirty rags from the kitchen. Wash white towels in hottest water with bleach. When dry, fold and return to the kitchen drawer below the oven. Do not bleach colored towels.",
      "Scour the kitchen sinks using diluted bleach. Clean all black gunk and white soap stains from corners/edges, metal drain traps, and gunk around/in drains.",
      "Refill all soap dispensers in the kitchen, including sponge wands (replace wands if necessary).",
      "Clear dish drying racks and clean under them. Wash drying racks if required.",
      "Wipe down the silver and black parts of the stove with the soft side of a sponge.",
      "Throw away old sponges and replace with new ones (as needed).",
      "Replace sponge heads on dishwashing wands (as needed)."
    ],
    "fridge and pantry (mix #2)": [
      "Throw out all uneaten leftovers and spoiled food in the silver fridge. Saves should be thrown after 5 days at most.",
      "Wipe the handles and outside of the fridge. Take out milk cans/juice bottles and clean/wipe the bottom rack thoroughly inside.",
      "Clean inside and outside of the microwave, toaster oven, bread toaster, and other small appliances (inside with soap and water, outside with disinfectant).",
      "Keep inside of the freezer clean. Throw out spoiled/expired food and uneaten leftovers.",
      "Clean the butcher block table in the blue kitchen with soap and water.",
      "Clean the pantry area by the stairs. Wash onion, potato, and garlic containers. Throw away spoiled produce."
    ],
    "sunday trash + dishes": [
      "TRASH: Empty trash from all bathrooms and replace bags (look in dining room closet).",
      "TRASH: Empty indoor trash cans (2 kitchen, 1 basement, dining room, living room). If messy/smelly, replace bags.",
      "TRASH: On Sunday evening, put outdoor trash cans to the street and put trash tags on them.",
      "TRASH: Bring all trash cans back from the street on Monday (ticketing risk if left out).",
      "DISHES (Sun–Tue): Before dinner, put away dry dishes from racks by front and back sinks.",
      "DISHES (Sun–Tue): Before dinner, empty the dishwasher and clean the dishwasher filter.",
      "DISHES (Sun–Tue): Make sure dishes are not dirty. If they are, wash them before putting away."
    ],
    "wednesday dishes + trash": [
      "DISHES (Wed–Sat): Empty freezer condensation trap.",
      "DISHES (Wed–Sat): Before dinner, put away dry dishes from racks by front and back sinks.",
      "DISHES (Wed–Sat): Before dinner, empty the dishwasher and clean the dishwasher filter.",
      "DISHES (Wed–Sat): Make sure dishes are not dirty. If they are, wash them before putting away.",
      "TRASH on Wednesday: Take out trash in kitchen trash cans and replace with new trash bags."
    ],
    "counters and recycling": [
      "Wipe and declutter ALL white counters in both kitchens. Remove dishes/small appliances and clean under/near them for stains.",
      "Empty all indoor recycling bins into outdoor recycling containers. Check entryway, living room, basement, and all bathrooms.",
      "Bring the indoor recycling bins back where they belong.",
      "Bring all outdoor recycling bins back inside on Monday if recycling was taken out (ticketing risk).",
      "If it is a collection week, take out recycling to the curb on Sunday night. Check recycletompkins.org for 116 Oak Ave pickup day.",
      "Pick the two dirtiest indoor recycling bins and wash them thoroughly. Place back after drying.",
      "ON WEDNESDAY: If any indoor recycling bin is more than 3/4 full, empty it into outdoor recycling containers."
    ]
  };

  // Create or clear the Subtasks sheet
  let subtaskSheet = ss.getSheetByName(SUBTASKS_SHEET_NAME);
  if (!subtaskSheet) {
    subtaskSheet = ss.insertSheet(SUBTASKS_SHEET_NAME);
  }
  subtaskSheet.clearContents();
  subtaskSheet.getRange(1, 1, 1, 3).setValues([["chore_id", "chore_name", "subtask_text"]]).setFontWeight("bold");
  subtaskSheet.setFrozenRows(1);

  // Match chore names and populate
  const rows = [];
  let matched = 0;
  let unmatched = [];

  // Build reverse map: lowercase name → original cased name
  const choreOrigName = {};
  choreData.slice(1).forEach(row => {
    const name = String(row[1]).trim();
    if (name) choreOrigName[name.toLowerCase()] = name;
  });

  for (const [choreName, subtasks] of Object.entries(subtasksByChore)) {
    // Find matching chore ID (case-insensitive)
    let choreId = choreMap[choreName];
    let displayName = choreOrigName[choreName] || choreName;

    // Try partial match if exact match fails
    if (!choreId) {
      for (const [mapName, mapId] of Object.entries(choreMap)) {
        if (mapName.includes(choreName) || choreName.includes(mapName)) {
          choreId = mapId;
          displayName = choreOrigName[mapName] || mapName;
          break;
        }
      }
    }

    if (choreId) {
      subtasks.forEach(text => rows.push([choreId, displayName, text]));
      matched++;
    } else {
      unmatched.push(choreName);
    }
  }

  if (rows.length > 0) {
    subtaskSheet.getRange(2, 1, rows.length, 3).setValues(rows);
    subtaskSheet.autoResizeColumns(1, 3);
  }

  let message = `Seeded ${rows.length} subtasks for ${matched} chores.`;
  if (unmatched.length > 0) {
    message += `\n\n⚠️ Could not match these chore names (check your Chores sheet):\n- ${unmatched.join('\n- ')}`;
  }
  SpreadsheetApp.getUi().alert(message);
}
