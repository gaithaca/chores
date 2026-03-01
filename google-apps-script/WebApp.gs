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

var SUBTASKS_SHEET_NAME = "Subtasks";
var SUBMISSIONS_SHEET_NAME = "Submissions";
// Extensions are now stored in ExtensionRequests sheet (status=approved)
var EXT_REQUESTS_SHEET_NAME = "ExtensionRequests";

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
        // Read approved extension requests as the canonical extensions
        const allReqs = fetchSheetRows_(ss, EXT_REQUESTS_SHEET_NAME);
        const cycleId = e.parameter.cycle_id;
        const approved = allReqs
          .filter(r => String(r.status).trim().toLowerCase() === 'approved')
          .filter(r => !cycleId || normalizeCycleId_(r.cycle_id) === normalizeCycleId_(cycleId))
          .map(r => ({
            id: r.id,
            net_id: r.net_id,
            cycle_id: r.cycle_id,
            extended_deadline: r.requested_date,
            granted_by: r.reviewed_by || '',
            granted_at: r.reviewed_at || '',
            reason: r.reason || ''
          }));
        return apiJsonResponse({ success: true, data: approved });
      }

      case 'getCycleInfo':
        return apiJsonResponse({ success: true, data: computeCycleInfo_(ss) });

      case 'getExtensionRequests': {
        const reqs = fetchSheetRows_(ss, EXT_REQUESTS_SHEET_NAME);
        const cycleId = e.parameter.cycle_id;
        const filtered = cycleId
          ? reqs.filter(r => normalizeCycleId_(r.cycle_id) === normalizeCycleId_(cycleId))
          : reqs;
        return apiJsonResponse({ success: true, data: filtered });
      }

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
// var DISCORD_WEBHOOK_URL = '';          // already set in Code.gs

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

      case 'requestExtension':
        return apiJsonResponse(handleRequestExtension_(ss, body));

      case 'approveExtension':
        return apiJsonResponse(handleApproveExtension_(ss, body));

      case 'reviewSubmission':
        return apiJsonResponse(handleReviewSubmission_(ss, body));

      case 'sendReviewEmail':
        return apiJsonResponse(handleSendReviewEmail_(ss, body));

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
  const note = String(body.note || '').trim();

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

    const fields = [
      { name: 'Chore', value: choreName || 'N/A', inline: true },
      { name: 'Fine Amount', value: `$${fineAmount}`, inline: true },
      { name: 'Week Of', value: cycleId || 'N/A', inline: true },
      { name: 'Issued By', value: grantedBy || 'House Manager', inline: true }
    ];
    if (note) {
      fields.push({ name: 'Justification', value: note, inline: false });
    }

    const payload = {
      content: pingLine,
      embeds: [{
        title: '💸 Chore Fine — $' + fineAmount,
        color: 0xEF4444,
        description: `**${memberName}** (${netId}) has been fined for not completing their chore.`,
        fields: fields,
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
    finesSheet.appendRow(['id', 'net_id', 'member_name', 'chore_name', 'fine_amount', 'cycle_id', 'granted_by', 'note', 'sent_at']);
  }

  const fineData = finesSheet.getDataRange().getValues();
  const fineIds = fineData.slice(1).map(r => parseInt(r[0]) || 0);
  const fineId = fineIds.length > 0 ? Math.max(...fineIds) + 1 : 1;
  finesSheet.appendRow([
    fineId, netId, memberName, choreName, fineAmount, cycleId, grantedBy, note, new Date().toISOString()
  ]);

  return { success: true, data: { id: fineId, discord_sent: !!DISCORD_WEBHOOK_URL } };
}

/**
 * Verifies manager/president credentials. Reads password from column G of the Members sheet.
 * Accepts roles: house_manager, president
 */
function verifyManager_(ss, body) {
  const netId = String(body.net_id || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!netId || !password) {
    return { success: false, error: 'Net ID and password are required.' };
  }

  const ALLOWED_ROLES = ['house_manager', 'president'];

  const sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return { success: false, error: 'Members sheet not found.' };
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][0]).trim().toLowerCase();
    const role = data[i].length > 5 ? String(data[i][5]).trim().toLowerCase() : '';
    const storedPw = data[i].length > 6 ? String(data[i][6]).trim() : '';

    if (rowId === netId) {
      if (ALLOWED_ROLES.indexOf(role) === -1) {
        return { success: false, error: 'This account does not have dashboard access.' };
      }
      if (!storedPw) {
        return { success: false, error: 'No password set for this account. Add one in column G of the Members sheet.' };
      }
      if (storedPw === password) {
        return { success: true, role: role };
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
    // Check for an approved extension request
    var extReqSheet = ss.getSheetByName(EXT_REQUESTS_SHEET_NAME);
    if (extReqSheet) {
      var extData = extReqSheet.getDataRange().getValues();
      // Columns: id(0)|net_id(1)|cycle_id(2)|reason(3)|requested_date(4)|status(5)
      for (var ei = 1; ei < extData.length; ei++) {
        if (String(extData[ei][1]).trim() === body.net_id &&
            normalizeCycleId_(extData[ei][2]) === normalizeCycleId_(cycleId) &&
            String(extData[ei][5]).trim().toLowerCase() === 'approved') {
          // Use requested_date as the extension deadline
          var rawExtDate = extData[ei][4];
          var extDeadline;
          if (rawExtDate instanceof Date) {
            extDeadline = new Date(rawExtDate);
          } else {
            extDeadline = new Date(String(rawExtDate).trim() + 'T08:00:00');
          }
          extDeadline.setHours(8, 0, 0, 0);
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

/**
 * Grants an extension by creating an auto-approved entry in ExtensionRequests.
 * Used for manual extensions from the dashboard "Extend" button.
 */
function handleGrantExtension_(ss, body) {
  var sheet = ss.getSheetByName(EXT_REQUESTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXT_REQUESTS_SHEET_NAME);
    sheet.appendRow(['id', 'net_id', 'cycle_id', 'reason', 'requested_date', 'status', 'requested_at', 'reviewed_by', 'reviewed_at', 'review_reason']);
  }

  var now = new Date();
  var data = sheet.getDataRange().getValues();
  var ids = data.slice(1).map(function(r) { return parseInt(r[0]) || 0; });
  var id = ids.length > 0 ? Math.max.apply(null, ids) + 1 : 1;

  // Parse the extended_deadline to get just the date part for requested_date
  var requestedDate = body.extended_deadline || '';
  if (requestedDate && requestedDate.includes('T')) {
    requestedDate = requestedDate.split('T')[0];
  }

  // Columns: id | net_id | cycle_id | reason | requested_date | status | requested_at | reviewed_by | reviewed_at | review_reason
  sheet.appendRow([
    id,
    body.net_id,
    body.cycle_id,
    body.reason || 'Manual extension',
    requestedDate,
    'approved',
    now.toISOString(),
    body.granted_by || '',
    now.toISOString(),
    'Granted directly by manager'
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

/**
 * Handles a resident's extension request.
 * Creates a row in ExtensionRequests: id | net_id | cycle_id | reason | requested_date | status | requested_at | reviewed_by | reviewed_at
 */
function handleRequestExtension_(ss, body) {
  const netId = String(body.net_id || '').trim();
  const cycleId = body.cycle_id || '';
  const reason = String(body.reason || '').trim();
  const requestedDate = String(body.requested_date || '').trim();

  if (!netId) return { success: false, error: 'Net ID is required.' };
  if (!reason) return { success: false, error: 'Please provide a reason for the extension.' };

  var sheet = ss.getSheetByName(EXT_REQUESTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXT_REQUESTS_SHEET_NAME);
    sheet.appendRow(['id', 'net_id', 'cycle_id', 'reason', 'requested_date', 'status', 'requested_at', 'reviewed_by', 'reviewed_at', 'review_reason']);
  }

  const data = sheet.getDataRange().getValues();
  const ids = data.slice(1).map(r => parseInt(r[0]) || 0);
  const id = ids.length > 0 ? Math.max(...ids) + 1 : 1;

  // Check if already requested this cycle
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === netId.toLowerCase() &&
        normalizeCycleId_(data[i][2]) === normalizeCycleId_(cycleId) &&
        String(data[i][5]).trim().toLowerCase() === 'pending') {
      return { success: false, error: 'You already have a pending extension request for this week.' };
    }
  }

  sheet.appendRow([id, netId, cycleId, reason, requestedDate, 'pending', new Date().toISOString(), '', '', '']);

  return { success: true, data: { id: id, status: 'pending' } };
}

/**
 * Approves or denies an extension request.
 * body: { request_id, decision ('approved'|'denied'), reviewed_by, extended_deadline (optional override) }
 * If approved, uses the resident's requested_date as the deadline (or override if provided).
 */
function handleApproveExtension_(ss, body) {
  const requestId = parseInt(body.request_id);
  const decision = String(body.decision || '').trim().toLowerCase();
  const reviewedBy = body.reviewed_by || '';
  const reviewReason = String(body.review_reason || '').trim();

  if (!requestId || !decision) return { success: false, error: 'Missing request_id or decision.' };
  if (decision !== 'approved' && decision !== 'denied') return { success: false, error: 'Decision must be "approved" or "denied".' };

  var sheet = ss.getSheetByName(EXT_REQUESTS_SHEET_NAME);
  if (!sheet) return { success: false, error: 'ExtensionRequests sheet not found.' };

  const data = sheet.getDataRange().getValues();
  var found = false;
  var reqRow = null;

  // Columns: id(0) | net_id(1) | cycle_id(2) | reason(3) | requested_date(4) | status(5) | requested_at(6) | reviewed_by(7) | reviewed_at(8) | review_reason(9)
  for (var i = 1; i < data.length; i++) {
    if (parseInt(data[i][0]) === requestId) {
      sheet.getRange(i + 1, 6).setValue(decision);               // status
      sheet.getRange(i + 1, 8).setValue(reviewedBy);              // reviewed_by
      sheet.getRange(i + 1, 9).setValue(new Date().toISOString()); // reviewed_at
      sheet.getRange(i + 1, 10).setValue(reviewReason);            // review_reason
      reqRow = data[i];
      found = true;
      break;
    }
  }

  if (!found) return { success: false, error: 'Extension request not found.' };

  // If approved, create the actual extension using the resident's requested date
  if (decision === 'approved') {
    var extDeadline = body.extended_deadline || '';
    if (!extDeadline) {
      // Use the resident's requested_date, set to 8AM
      var rawReqDate = reqRow[4];
      if (rawReqDate) {
        var d;
        if (rawReqDate instanceof Date) {
          d = new Date(rawReqDate);
        } else {
          // It's a string like "2026-03-01"
          d = new Date(String(rawReqDate).trim() + 'T08:00:00');
        }
        if (!isNaN(d.getTime())) {
          d.setHours(8, 0, 0, 0);
          extDeadline = d.toISOString();
        }
      }
      // Fallback if requested_date was empty or invalid
      if (!extDeadline) {
        var rawCycleDate = reqRow[2];
        var cycleDate;
        if (rawCycleDate instanceof Date) {
          cycleDate = new Date(rawCycleDate);
        } else {
          cycleDate = new Date(String(rawCycleDate).trim() + 'T00:00:00');
        }
        cycleDate.setDate(cycleDate.getDate() + 2);
        cycleDate.setHours(8, 0, 0, 0);
        extDeadline = cycleDate.toISOString();
      }
    }

    // No need to create a separate extension — the approved request IS the extension.
    // The requested_date (column 4) is used as the extension deadline.
  }

  // Send email notification to the resident about the decision
  try {
    var netId = String(reqRow[1]).trim();
    var members = fetchMembers_(ss);
    var member = null;
    for (var mi = 0; mi < members.length; mi++) {
      if (members[mi].net_id === netId) { member = members[mi]; break; }
    }
    if (member && member.email) {
      var memberName = member.name || netId;
      var isApproved = decision === 'approved';
      var reqDateRaw = reqRow[4];
      var reqDateDisplay = '';
      if (reqDateRaw instanceof Date) {
        reqDateDisplay = Utilities.formatDate(reqDateRaw, Session.getScriptTimeZone(), 'EEE, MMM d');
      } else if (reqDateRaw) {
        var pd = new Date(String(reqDateRaw).trim() + 'T00:00:00');
        if (!isNaN(pd.getTime())) reqDateDisplay = Utilities.formatDate(pd, Session.getScriptTimeZone(), 'EEE, MMM d');
      }
      var reason = String(reqRow[3] || '').trim();

      var statusColor = isApproved ? '#22c55e' : '#ef4444';
      var statusIcon = isApproved ? '✅' : '❌';
      var statusLabel = isApproved ? 'Approved' : 'Denied';

      var emailHtml = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">' +
        '<div style="background:linear-gradient(135deg,' + (isApproved ? '#22c55e,#16a34a' : '#ef4444,#dc2626') + ');padding:24px;border-radius:12px 12px 0 0;color:#fff;">' +
          '<h2 style="margin:0 0 6px 0;">' + statusIcon + ' Extension Request ' + statusLabel + '</h2>' +
          '<p style="margin:0;opacity:0.9;">Hi ' + memberName + ', your extension request has been reviewed.</p>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #e9ecef;border-top:none;padding:20px;border-radius:0 0 12px 12px;">' +
          '<div style="margin-bottom:16px;padding:12px 16px;border-radius:8px;background:' + (isApproved ? '#f0fdf4' : '#fef2f2') + ';border-left:4px solid ' + statusColor + ';">' +
            '<span style="font-weight:600;color:' + statusColor + ';font-size:18px;">' + statusIcon + ' ' + statusLabel + '</span>' +
            (isApproved && reqDateDisplay ? '<div style="margin-top:6px;color:#495057;">Your new deadline is <strong>' + reqDateDisplay + ' at 8:00 AM</strong></div>' : '') +
          '</div>' +
          '<div style="margin-bottom:12px;"><span style="font-weight:600;">Your reason:</span> "' + reason + '"</div>' +
          (reqDateDisplay ? '<div style="margin-bottom:12px;"><span style="font-weight:600;">Requested until:</span> ' + reqDateDisplay + '</div>' : '') +
          (reviewReason ? '<div style="margin-top:16px;padding:12px 16px;background:#f8f9fa;border-radius:8px;border-left:3px solid #4a6cf7;">' +
            '<div style="font-size:13px;font-weight:600;color:#6c757d;margin-bottom:4px;">📝 Manager\'s Note</div>' +
            '<div style="color:#495057;">' + reviewReason + '</div>' +
          '</div>' : '') +
          '<div style="margin-top:20px;font-size:13px;color:#6c757d;">Reviewed by ' + reviewedBy + ' · ΓΑ Chore Tracker</div>' +
        '</div>' +
      '</body></html>';

      MailApp.sendEmail({
        to: member.email,
        subject: statusIcon + ' Extension ' + statusLabel + ' — ΓΑ Chore Tracker',
        htmlBody: emailHtml
      });
    }
  } catch (emailErr) {
    // Don't fail the whole action if email fails
    Logger.log('Extension email error: ' + emailErr);
  }

  return { success: true, data: { request_id: requestId, decision: decision } };
}

// ─── Manager Submission Review ────────────────────────
/**
 * Saves a manager's review of a submission.
 * body: { submission_id, review_checks (array of booleans), review_reason, reviewed_by }
 * Writes to columns 9 (manager_review_json) and 10 (review_reason) of the Submissions sheet.
 */
function handleReviewSubmission_(ss, body) {
  const submissionId = parseInt(body.submission_id);
  if (!submissionId) return { success: false, error: 'Missing submission_id.' };

  var sheet = ss.getSheetByName(SUBMISSIONS_SHEET_NAME);
  if (!sheet) return { success: false, error: 'Submissions sheet not found.' };

  const data = sheet.getDataRange().getValues();
  var found = false;

  // Submissions columns: id(0) | net_id(1) | chore_id(2) | subtasks_checked_json(3) | submitted_at(4) | cycle_id(5) | is_late(6) | note(7) | manager_review_json(8) | review_reason(9)
  for (var i = 1; i < data.length; i++) {
    if (parseInt(data[i][0]) === submissionId) {
      var reviewJson = JSON.stringify(body.review_checks || []);
      var reviewReason = String(body.review_reason || '').trim();
      var reviewedBy = String(body.reviewed_by || '').trim();
      // Combine reviewed_by into the reason for traceability
      var fullReason = reviewedBy ? '[' + reviewedBy + '] ' + reviewReason : reviewReason;
      sheet.getRange(i + 1, 9).setValue(reviewJson);     // manager_review_json
      sheet.getRange(i + 1, 10).setValue(fullReason);     // review_reason
      found = true;
      break;
    }
  }

  if (!found) return { success: false, error: 'Submission not found.' };
  return { success: true, data: { submission_id: submissionId } };
}

// ─── Send Review Email ────────────────────────────────
/**
 * Sends the manager's chore review to the resident via email.
 * body: { net_id, member_name, chore_name, subtasks (array of {name, resident, manager}), review_reason, reviewed_by, cycle_id }
 */
function handleSendReviewEmail_(ss, body) {
  var netId = String(body.net_id || '').trim();
  if (!netId) return { success: false, error: 'Missing net_id.' };

  // Look up email from Members sheet
  var members = fetchMembers_(ss);
  var member = null;
  for (var i = 0; i < members.length; i++) {
    if (members[i].net_id === netId) { member = members[i]; break; }
  }
  if (!member || !member.email) return { success: false, error: 'No email found for ' + netId };

  var memberName = body.member_name || member.name || netId;
  var choreName = body.chore_name || 'Chore';
  var subtasks = body.subtasks || [];
  var reviewReason = String(body.review_reason || '').trim();
  var reviewedBy = body.reviewed_by || 'House Manager';
  var cycleId = body.cycle_id || '';

  // Count stats
  var totalComplete = 0;
  for (var j = 0; j < subtasks.length; j++) {
    if (subtasks[j].manager) totalComplete++;
  }

  // Build subtask rows
  var subtaskRows = '';
  for (var k = 0; k < subtasks.length; k++) {
    var st = subtasks[k];
    var rowBg = k % 2 === 0 ? '#f8f9fa' : '#ffffff';
    var mgrIcon = st.manager ? '✅' : '❌';
    var resIcon = st.resident ? '✅' : '⬜';
    subtaskRows += '<tr style="background:' + rowBg + ';">' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e9ecef;">' + st.name + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e9ecef;text-align:center;">' + resIcon + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e9ecef;text-align:center;">' + mgrIcon + '</td>' +
      '</tr>';
  }

  var statusColor = totalComplete === subtasks.length ? '#22c55e' : '#ef4444';
  var statusText = totalComplete === subtasks.length ? 'All Tasks Complete ✅' : totalComplete + ' of ' + subtasks.length + ' Verified Complete';

  var htmlBody = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">' +
    '<div style="background:linear-gradient(135deg,#4a6cf7,#7c3aed);padding:24px;border-radius:12px 12px 0 0;color:#fff;">' +
      '<h2 style="margin:0 0 6px 0;">📋 Chore Review</h2>' +
      '<p style="margin:0;opacity:0.9;">Hi ' + memberName + ', here\'s your chore review for the week of ' + cycleId + '.</p>' +
    '</div>' +
    '<div style="background:#fff;border:1px solid #e9ecef;border-top:none;padding:20px;border-radius:0 0 12px 12px;">' +
      '<div style="margin-bottom:16px;">' +
        '<span style="font-weight:600;">Chore:</span> ' + choreName +
      '</div>' +
      '<div style="margin-bottom:16px;padding:10px 14px;border-radius:8px;background:' + (totalComplete === subtasks.length ? '#f0fdf4' : '#fef2f2') + ';border-left:4px solid ' + statusColor + ';">' +
        '<span style="font-weight:600;color:' + statusColor + ';">' + statusText + '</span>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e9ecef;">' +
        '<thead><tr style="background:#f1f3f5;">' +
          '<th style="padding:10px 14px;text-align:left;font-weight:600;color:#495057;">Subtask</th>' +
          '<th style="padding:10px 14px;text-align:center;font-weight:600;color:#495057;width:80px;">You</th>' +
          '<th style="padding:10px 14px;text-align:center;font-weight:600;color:#495057;width:80px;">Manager</th>' +
        '</tr></thead>' +
        '<tbody>' + subtaskRows + '</tbody>' +
      '</table>' +
      (reviewReason ? '<div style="margin-top:16px;padding:12px 16px;background:#f8f9fa;border-radius:8px;border-left:3px solid #4a6cf7;">' +
        '<div style="font-size:13px;font-weight:600;color:#6c757d;margin-bottom:4px;">📝 Manager Notes</div>' +
        '<div style="color:#495057;">' + reviewReason + '</div>' +
      '</div>' : '') +
      '<div style="margin-top:20px;font-size:13px;color:#6c757d;">Reviewed by ' + reviewedBy + ' · ΓΑ Chore Tracker</div>' +
    '</div>' +
  '</body></html>';

  MailApp.sendEmail({
    to: member.email,
    subject: '📋 Chore Review: ' + choreName + ' — Week of ' + cycleId,
    htmlBody: htmlBody
  });

  return { success: true, data: { sent_to: member.email } };
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
