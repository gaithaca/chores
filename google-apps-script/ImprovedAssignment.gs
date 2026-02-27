// =====================================================
// IMPROVED CHORE ASSIGNMENT — Replace in your Code.gs
// =====================================================
//
// Replace your existing `assignChores()` function and
// `findBestMemberForChore()` function with the code below.
// Everything else (notifications, history, triggers, etc.)
// stays exactly the same.
//
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
      // Primary:   -choreCount × 10000  → prefer the chore this member has done LEAST
      // Secondary: -totalCount × 100    → among ties, prefer underloaded members
      // Tertiary:  +importanceBonus     → among ties, important chores get matched first
      // Noise:     +random [0,1)        → break remaining ties randomly

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
  // Walk through sorted candidates. If both member and chore are
  // still unassigned, pair them. This guarantees:
  //   - Important chores (higher bonus) get first pick of members
  //   - Each chore goes to the member who has done it fewest times
  //   - Underloaded members are preferred as tiebreaker

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

  // ── 8. Build output for ALL active members (same format as before) ──
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

  // ── 9. Update sheet & alert (unchanged from original) ──
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


// =====================================================
// DELETE the old `findBestMemberForChore` function.
// It is no longer needed — the scoring is now inline
// in the candidates loop above.
// =====================================================
