/**
 * Gamma Alpha Chore Tracker — Frontend Application
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CONFIGURATION: Set your Google Apps Script deployment URL  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const API_URL = 'https://script.google.com/macros/s/AKfycbxlE15T9roNsAKoerKKxVYqEjh0xEfbTQQVoAZ9K1ye5IpDKl1eW_L-xvSApI8-Jyns/exec';

// Set to true for local testing without Google Sheets
const DEMO_MODE = false;

// ---- TIME CONFIGURATION (must match Code.gs) ----
const DEADLINE_HOUR = 7;           // Hour (0-23) when chores are due
const DEADLINE_DISPLAY = '7:00 AM'; // Human-readable version for UI text

// ─── App State ────────────────────────────────────────

let appData = {
    members: [],
    chores: [],
    cycleInfo: null
};

let currentCycleId = '';
let residentViewCycleId = '';
let currentUser = null;
let currentChore = null;
let managerNetId = null;
let viewingCycleId = '';

// ─── Demo Data (used when DEMO_MODE = true) ──────────

const DEMO_CHORES = [
    {
        chore_id: "1", name: "Flex Chore", subtasks: [
            "Oil the butcher block table with mineral oil from the dining room closet.",
            "Scrub all parts of the stovetop and the front of the ovens (see posted stove care info).",
            "Remove two of the racks from the fridge and wash the racks and the inside of the fridge with soap and water.",
            "Take trash cans outside, add vinegar and water, scrub the inside with a brush/broom. Pour dirty water on the street and leave cans upside-down to dry.",
            "Scrape out and bag up loose trash at the bottom of outdoor garbage bins. Wash two of the dirtiest bins with the hose. Let dry and return.",
            "From November to April (or whenever heat is on), drain sediment from the furnace. Sign the boiler log in the basement."
        ]
    },
    {
        chore_id: "2", name: "Chefs - Cooking Dinner", subtasks: [
            "After dinner, run the dishwasher.",
            "Check that the garbage disposal is not clogged by running it with flowing cold water.",
            "Clean the drain and the edges where the dishwasher closes, removing gunk from corners and seals.",
            "Arrange the dishwasher so that dishes do not block the water flow.",
            "Refill rinse-aid compartment with vinegar or rinse-aid.",
            "Wood, non-stick or other delicate dishes should be washed by hand only!",
            "Plastic containers are only washed on the top shelf. If washing plastic, turn off 'dry heat'."
        ]
    },
    {
        chore_id: "3", name: "First Floor Bathroom", subtasks: [
            "Scrub the toilet including outside fixture, under the lip, and the drain area. (Use toilet bowl cleaner)",
            "Clean the sink including the drain. (Use lysol/bleach or disinfectant)",
            "Use a brush to scrub and clean the faucet.",
            "Clean the mirror.",
            "Restock toilet paper and refill soap dispensers.",
            "Sweep and mop the floor with Mr. Clean multipurpose cleaner. Use mop marked 'bathroom'.",
            "Collect towels from all three bathrooms. Wash at 95°C. Fold and return when dry.",
            "Collect dirty bath mats from upstairs. Wash gentle cycle, no bleach. Hang to dry. Replace in east/west bathrooms."
        ]
    },
    {
        chore_id: "4", name: "West (Small) Bathroom", subtasks: [
            "Scrub the shower stall including walls, metal parts, floor, and shelves. Remove mold with diluted bleach and Bon Ami.",
            "Scrub the toilet including outside fixture, under the lip, and the drain area. (Use toilet bowl cleaner)",
            "Clean the sink including the drain. (Use disinfectant)",
            "Use a brush to scrub and clean the faucet.",
            "Clean the mirror.",
            "Restock toilet paper.",
            "Refill soap dispensers.",
            "Sweep and mop the floor with Mr. Clean (use mop marked 'bathroom'). Return to dining room supply closet.",
            "Remove spider webs from corners (including ceiling)."
        ]
    },
    {
        chore_id: "5", name: "East (Large) Bathroom", subtasks: [
            "Scrub the shower stall including walls, metal parts, floor, under ledge, and shelves. Remove mold with bleach and Bon Ami.",
            "Scrub the toilet including outside fixture, under the lip, and the drain area. (Use toilet bowl cleaner)",
            "Clean the sink including the drain. (Use disinfectant)",
            "Use a brush to scrub and clean the faucet.",
            "Clean the mirror.",
            "Restock toilet paper.",
            "Refill soap dispensers.",
            "Sweep and mop the floor with Mr. Clean (use mop marked 'bathroom'). Return to dining room supply closet.",
            "Remove spider webs from corners (including ceiling)."
        ]
    },
    {
        chore_id: "6", name: "Lawn, Sidewalk & Porch/Compost", subtasks: [
            "In Winter (Nov–Feb): Shovel snow from the sidewalk (within 1 day of each snowfall).",
            "Other Seasons: Rake leaves.",
            "Mow the lawn (ticket risk if grass exceeds 9 inches).",
            "Clean up trash from the lawn and front entrance.",
            "Keep front yard neat, removing weeds and trimming overgrowth.",
            "(If compost is active) Turn compost piles, adding leaves/lime to balance vegetable matter.",
            "Tidy the porch: sweep, wipe, and arrange chairs and tables."
        ]
    },
    {
        chore_id: "7", name: "Front Rooms", subtasks: [
            "Vacuum the big carpet in the foyer.",
            "Sweep or vacuum the floor and mop all floors. Use mop labeled 'wood'.",
            "Clean the window in the door to the entry room.",
            "Clean the table tops and straighten as needed.",
            "Vacuum spider webs from all walls and corners (including near the ceiling).",
            "Clean dust from the piano and all tables and surfaces in the four rooms.",
            "Straighten and vacuum the front entrance area."
        ]
    },
    {
        chore_id: "8", name: "Hallways & Entry Room", subtasks: [
            "Check the vacuum bag — is it ripped or full? Charge it as needed.",
            "Sweep the front and back stairwells including the basement stairwell.",
            "Sweep 2nd and 3rd floor hallways (use a damp mop for dirty spots).",
            "Vacuum the front stairs and 2nd floor hallway.",
            "Take rugs from entry room outside and shake them out.",
            "Remove all rugs/shoes/furniture from entry room. Sweep/Vacuum/Mop (use 'Wood' mop). Dry and return furniture.",
            "Dust the stair railings and windowsills.",
            "Check and change the lint filter on the basement sink if clogged.",
            "Clean the top of the washing machine and the dryer.",
            "Clean/straighten the laundry area."
        ]
    },
    {
        chore_id: "9", name: "Kitchen", subtasks: [
            "Sweep kitchen floors, under the table, recycling area, and under both sinks.",
            "Mop kitchen floors with hot water and Mr. Clean (use mop labeled 'Kitchen').",
            "Collect oven mitts and return to where they belong.",
            "Wash the serving and dining tables with soap/vinegar.",
            "Turn chairs up on the table to sweep dining room floors.",
            "Mop dining room floors with Murphy's oil soap (use mop labeled 'wood').",
            "Put chairs/stools back down after mopping."
        ]
    },
    {
        chore_id: "10", name: "Sinks & Towels (Mix #1)", subtasks: [
            "(If compost is active) Empty the compost bucket from the kitchen.",
            "(If compost is active) Wash the compost bucket with soap/bleach and water.",
            "(If compost is active) Wash the wall behind the compost bucket.",
            "Collect all towels and dirty rags from the kitchen. Wash white towels in hottest water with bleach. Fold and return.",
            "Scour the kitchen sinks using diluted bleach — clean all gunk from corners, drain traps, and drains.",
            "Refill all kitchen soap dispensers including sponge wands (replace if necessary).",
            "Clear dish drying racks, clean under them, wash racks if required.",
            "Wipe down the silver and black parts of the stove with soft side of sponge.",
            "Throw away old sponges and replace with new ones (as needed).",
            "Replace sponge heads on dishwashing wands (as needed)."
        ]
    },
    {
        chore_id: "11", name: "Fridge & Pantry (Mix #2)", subtasks: [
            "Throw out all uneaten leftovers and spoiled food in the silver fridge. Saves expire after 5 days.",
            "Wipe fridge handles and outside. Clean/wipe bottom rack thoroughly inside.",
            "Clean inside and outside of microwave, toaster oven, bread toaster, and other small appliances.",
            "Keep inside of the freezer clean. Throw out spoiled/expired food.",
            "Clean the butcher block table in the blue kitchen with soap and water.",
            "Clean the pantry area by the stairs. Wash onion/potato/garlic containers. Throw away spoiled produce."
        ]
    },
    {
        chore_id: "12", name: "Sunday Trash + Dishes", subtasks: [
            "TRASH: Empty trash from all bathrooms and replace bags.",
            "TRASH: Empty indoor trash cans (2 kitchen, 1 basement, dining room, living room). Replace bags if messy.",
            "TRASH: On Sunday evening, put outdoor trash cans to the street with trash tags.",
            "TRASH: Bring all trash cans back from the street on Monday.",
            "DISHES (Sun–Tue): Before dinner, put away dry dishes from drying racks.",
            "DISHES (Sun–Tue): Before dinner, empty the dishwasher and clean the filter.",
            "DISHES (Sun–Tue): Check dishes are clean. If dirty, wash before putting away."
        ]
    },
    {
        chore_id: "13", name: "Wednesday Dishes + Trash", subtasks: [
            "DISHES (Wed–Sat): Empty freezer condensation trap.",
            "DISHES (Wed–Sat): Before dinner, put away dry dishes from drying racks.",
            "DISHES (Wed–Sat): Before dinner, empty the dishwasher and clean the filter.",
            "DISHES (Wed–Sat): Check dishes are clean. If dirty, wash before putting away.",
            "TRASH on Wednesday: Take out trash in kitchen trash cans and replace bags."
        ]
    },
    {
        chore_id: "14", name: "Counters & Recycling", subtasks: [
            "Wipe and declutter ALL white counters in both kitchens. Clean under/near dishes and appliances.",
            "Empty all indoor recycling bins into outdoor containers. Check entryway, living room, basement, bathrooms.",
            "Bring indoor recycling bins back where they belong.",
            "Bring outdoor recycling bins back inside on Monday (ticketing risk).",
            "If collection week, take recycling to curb Sunday night. Check recycletompkins.org for 116 Oak Ave.",
            "Pick two dirtiest indoor recycling bins. Wash thoroughly. Place back after drying.",
            "ON WEDNESDAY: If any indoor bin is more than 3/4 full, empty into outdoor containers."
        ]
    }
];

const DEMO_MEMBERS = [
    { net_id: "abc12", name: "Alice Chen", role: "resident" },
    { net_id: "def34", name: "David Foster", role: "resident" },
    { net_id: "ghi56", name: "Grace Hernandez", role: "resident" },
    { net_id: "jkl78", name: "James Kim", role: "resident" },
    { net_id: "mno90", name: "Maria Okonkwo", role: "resident" },
    { net_id: "pqr11", name: "Priya Ramirez", role: "resident" },
    { net_id: "stu22", name: "Samuel Torres", role: "resident" },
    { net_id: "vwx33", name: "Victoria Wang", role: "resident" },
    { net_id: "yza44", name: "Yuki Andersen", role: "resident" },
    { net_id: "bcd55", name: "Benjamin Davis", role: "resident" },
    { net_id: "efg66", name: "Elena Gonzalez", role: "resident" },
    { net_id: "hij77", name: "Henry Johnson", role: "resident" },
    { net_id: "hm01", name: "Olivia Martinez", role: "house_manager" }
];

let demoAssignments = [];
let demoSubmissions = [];
let demoFines = [];
let demoExtensions = [];

// ─── Date Utilities ───────────────────────────────────

function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
}

function formatDateShort(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
}

function formatCycleDisplay(cycleId) {
    if (!cycleId) return 'Loading...';
    // cycleId is "YYYY-MM-DD" (a Monday date)
    const d = new Date(cycleId + 'T00:00:00');
    if (isNaN(d.getTime())) return cycleId;
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const day = d.getDate();
    return `Week of ${month} ${day}, ${d.getFullYear()}`;
}

function getTimeRemaining(deadline) {
    const now = new Date();
    const dl = new Date(deadline);
    const diff = dl - now;
    if (diff <= 0) return { text: 'PAST DEADLINE', overdue: true };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    let text = '';
    if (days > 0) text += `${days}d `;
    if (hours > 0) text += `${hours}h `;
    text += `${mins}m remaining`;

    return { text, overdue: false, days };
}

// ─── API Layer ────────────────────────────────────────

async function apiGet(action, params = {}) {
    if (DEMO_MODE) return demoGet(action, params);

    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    try {
        const res = await fetch(url.toString());
        return await res.json();
    } catch (err) {
        console.error(`API GET ${action} failed:`, err);
        return { success: false, error: err.message };
    }
}

async function apiPost(action, body) {
    if (DEMO_MODE) return demoPost(action, body);

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action, ...body })
        });
        return await res.json();
    } catch (err) {
        console.error(`API POST ${action} failed:`, err);
        return { success: false, error: err.message };
    }
}

// ─── Demo Data Layer ──────────────────────────────────

function initDemoData() {
    const cycleId = '2026-02-23'; // A Monday
    appData.members = DEMO_MEMBERS;
    appData.chores = DEMO_CHORES;
    appData.cycleInfo = {
        cycle_id: cycleId,
        deadline: new Date(`2026-03-02T${String(DEADLINE_HOUR).padStart(2,'0')}:00:00`).toISOString(),
        now: new Date().toISOString()
    };

    demoAssignments = [
        { cycle_id: cycleId, net_id: "abc12", chore_id: "1", member_name: "Alice Chen", chore_name: "Flex Chore" },
        { cycle_id: cycleId, net_id: "def34", chore_id: "3", member_name: "David Foster", chore_name: "First Floor Bathroom" },
        { cycle_id: cycleId, net_id: "ghi56", chore_id: "5", member_name: "Grace Hernandez", chore_name: "East (Large) Bathroom" },
        { cycle_id: cycleId, net_id: "jkl78", chore_id: "7", member_name: "James Kim", chore_name: "Front Rooms" },
        { cycle_id: cycleId, net_id: "mno90", chore_id: "9", member_name: "Maria Okonkwo", chore_name: "Kitchen" },
        { cycle_id: cycleId, net_id: "pqr11", chore_id: "10", member_name: "Priya Ramirez", chore_name: "Sinks & Towels (Mix #1)" },
        { cycle_id: cycleId, net_id: "stu22", chore_id: "12", member_name: "Samuel Torres", chore_name: "Sunday Trash + Dishes" },
        { cycle_id: cycleId, net_id: "vwx33", chore_id: "14", member_name: "Victoria Wang", chore_name: "Counters & Recycling" },
        { cycle_id: cycleId, net_id: "yza44", chore_id: "2", member_name: "Yuki Andersen", chore_name: "Chefs - Cooking Dinner" },
    ];

    const earlyTime = new Date('2026-03-01T19:00:00');
    const lateTime = new Date('2026-03-02T10:30:00');

    demoSubmissions = [
        {
            id: 1, net_id: "abc12", chore_id: "1",
            subtasks_checked_json: JSON.stringify([true, true, true, true, true, false]),
            submitted_at: earlyTime.toISOString(), cycle_id: cycleId, is_late: 0,
            note: "Ran out of mineral oil, couldn't oil the butcher block."
        },
        {
            id: 2, net_id: "def34", chore_id: "3",
            subtasks_checked_json: JSON.stringify([true, true, true, true, true, true, true, true]),
            submitted_at: lateTime.toISOString(), cycle_id: cycleId, is_late: 1,
            note: ""
        }
    ];

    demoExtensions = [];
}

function demoGet(action, params) {
    switch (action) {
        case 'getMembers':
            return { success: true, data: appData.members };
        case 'getChores':
            return { success: true, data: appData.chores };
        case 'getAssignments': {
            const cid = params.cycle_id;
            return { success: true, data: cid ? demoAssignments.filter(a => a.cycle_id === cid) : demoAssignments };
        }
        case 'getSubmissions': {
            const cid = params.cycle_id;
            return { success: true, data: cid ? demoSubmissions.filter(s => s.cycle_id === cid) : demoSubmissions };
        }
        case 'getExtensions': {
            const cid = params.cycle_id;
            return { success: true, data: cid ? demoExtensions.filter(e => e.cycle_id === cid) : demoExtensions };
        }
        case 'getCycleInfo':
            return { success: true, data: appData.cycleInfo };
        default:
            return { success: false, error: 'Unknown action' };
    }
}

function demoPost(action, body) {
    switch (action) {
        case 'submitChore': {
            const now = new Date();
            const cycleId = body.cycle_id;
            const deadline = new Date(appData.cycleInfo.deadline);
            let isLate = 0;
            if (now > deadline) {
                isLate = 1;
                const ext = demoExtensions.find(e => e.net_id === body.net_id && e.cycle_id === cycleId);
                if (ext && new Date(ext.extended_deadline) > now) isLate = 0;
            }
            const sub = {
                id: demoSubmissions.length + 1, net_id: body.net_id, chore_id: body.chore_id,
                subtasks_checked_json: JSON.stringify(body.subtasks_checked),
                submitted_at: now.toISOString(), cycle_id: cycleId, is_late: isLate,
                note: body.note || ''
            };
            demoSubmissions.push(sub);
            return { success: true, data: { ...sub, subtasks_checked: body.subtasks_checked } };
        }
        case 'grantExtension': {
            const ext = {
                id: demoExtensions.length + 1, net_id: body.net_id, cycle_id: body.cycle_id,
                extended_deadline: body.extended_deadline, granted_by: body.granted_by,
                granted_at: new Date().toISOString(), reason: body.reason || ''
            };
            demoExtensions.push(ext);
            return { success: true, data: ext };
        }
        case 'reviewUnsubmitted': {
            const now = new Date();
            const sub = {
                id: demoSubmissions.length + 1,
                net_id: body.net_id,
                chore_id: body.chore_id,
                subtasks_checked_json: JSON.stringify(new Array((body.review_checks || []).length).fill(false)),
                submitted_at: now.toISOString(),
                cycle_id: body.cycle_id,
                is_late: 1,
                reviewed: true,
                note: '[Manager review — no resident submission]',
                manager_review_json: JSON.stringify(body.review_checks || []),
                review_reason: (body.reviewed_by ? '[' + body.reviewed_by + '] ' : '') + (body.review_reason || '')
            };
            demoSubmissions.push(sub);
            return { success: true, data: { submission_id: sub.id } };
        }
        case 'reviewSubmission': {
            const sub = demoSubmissions.find(s => s.id === body.submission_id);
        
            if (sub) {
                sub.reviewed = true;
                console.log('Review updated:', sub);
            } else {
                console.log('Could not find submission:', body.submission_id);
            }
        
            return {
                success: true,
                data: { submission_id: body.submission_id }
            };
        }
        case 'sendReviewEmail':
            return { success: true, data: { sent_to: 'demo@example.com' } };
        case 'sendFine': {
            const fine = {
                id: demoFines.length + 1,
                net_id: body.net_id,
                cycle_id: body.cycle_id,
                amount: body.fine_amount,
                issued_by: body.granted_by,
                issued_at: new Date().toISOString(),
                note: body.note || ''
            };
        
            demoFines.push(fine);
        
            return {
                success: true,
                data: fine
            };
        }
        default:
            return { success: false, error: 'Unknown action' };
    }
}

// ─── Toast ────────────────────────────────────────────

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

// ─── Navigation ───────────────────────────────────────

document.getElementById('nav-resident').addEventListener('click', () => switchView('resident'));
document.getElementById('nav-dashboard').addEventListener('click', () => switchView('dashboard'));

// Populate deadline display text from config
const deadlineDisplayEl = document.getElementById('deadline-display-text');
if (deadlineDisplayEl) deadlineDisplayEl.textContent = DEADLINE_DISPLAY;

function switchView(view) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`).classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');
}

// ─── Initialization ───────────────────────────────────

let appReadyResolve;
const appReady = new Promise(resolve => { appReadyResolve = resolve; });

async function initApp() {
    if (DEMO_MODE) {
        initDemoData();
    } else {
        // Fetch core data from Google Sheets
        const [membersRes, choresRes, cycleRes] = await Promise.all([
            apiGet('getMembers'),
            apiGet('getChores'),
            apiGet('getCycleInfo')
        ]);

        if (membersRes.success) appData.members = membersRes.data;
        if (choresRes.success) appData.chores = choresRes.data;
        if (cycleRes.success) appData.cycleInfo = cycleRes.data;
    }

    currentCycleId = appData.cycleInfo ? appData.cycleInfo.cycle_id : '';
    residentViewCycleId = currentCycleId;
    updateCycleDisplay();
    updateResidentCycleNav();
    appReadyResolve(); // Signal that data is loaded
}

// ─── Resident Week Navigation ─────────────────────────

function shiftCycleId(cycleId, days) {
    const d = new Date(cycleId + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function updateResidentCycleNav() {
    document.getElementById('resident-cycle-text').textContent = formatCycleDisplay(residentViewCycleId);
    // Disable ▶ when on current week (can't submit for future weeks)
    const nextBtn = document.getElementById('resident-next-week');
    nextBtn.disabled = residentViewCycleId >= currentCycleId;
    nextBtn.style.opacity = nextBtn.disabled ? '0.3' : '1';
}

document.getElementById('resident-prev-week').addEventListener('click', () => {
    residentViewCycleId = shiftCycleId(residentViewCycleId, -7);
    updateResidentCycleNav();
    loadHouseStatus();
    // If user is already identified, re-fetch their assignment for the new week
    if (currentUser) {
        stepChore.classList.add('hidden');
        stepSubtasks.classList.add('hidden');
        stepConfirmation.classList.add('hidden');
        currentChore = null;
        handleNetIdSubmit();
    }
});

document.getElementById('resident-next-week').addEventListener('click', () => {
    if (residentViewCycleId >= currentCycleId) return;
    residentViewCycleId = shiftCycleId(residentViewCycleId, 7);
    updateResidentCycleNav();
    loadHouseStatus();
    if (currentUser) {
        stepChore.classList.add('hidden');
        stepSubtasks.classList.add('hidden');
        stepConfirmation.classList.add('hidden');
        currentChore = null;
        handleNetIdSubmit();
    }
});

function updateCycleDisplay() {
    if (!appData.cycleInfo) return;

    console.trace("updateCycleDisplay called with:", appData.cycleInfo.deadline);

    const displayText = formatCycleDisplay(appData.cycleInfo.cycle_id);
    document.getElementById('resident-cycle-text').textContent = displayText;
    document.getElementById('dashboard-cycle-text').textContent = displayText;

    const deadline = new Date(appData.cycleInfo.deadline);

    // Keep dashboard using existing formatter (unchanged for now)
    document.getElementById('deadline-time').textContent =
        formatDate(appData.cycleInfo.deadline);

    // ✅ FIXED: resident view uses consistent timezone formatting
    const resDeadline = document.getElementById('resident-deadline-time');
    if (resDeadline) {
        resDeadline.textContent = deadline.toLocaleString('en-US', {
            weekday: 'long',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/New_York'
        });
    }

    updateCountdown(deadline);

    clearInterval(window.countdownInterval);
    window.countdownInterval = setInterval(() => updateCountdown(deadline), 60000);
}



function updateCountdown(deadline) {
    const remaining = getTimeRemaining(deadline);

    // Dashboard countdown
    const el = document.getElementById('deadline-countdown');
    el.textContent = remaining.text;
    el.className = 'deadline-countdown ' + (remaining.overdue ? 'overdue' : remaining.days < 1 ? 'upcoming' : 'ok');

    // Resident countdown
    const resEl = document.getElementById('resident-deadline-countdown');
    if (resEl) {
        resEl.textContent = remaining.text;
        resEl.className = 'deadline-countdown ' + (remaining.overdue ? 'overdue' : remaining.days < 1 ? 'upcoming' : 'ok');
    }
}

// Helper to find a chore by ID from appData
function findChore(choreId) {
    return appData.chores.find(c => String(c.chore_id) === String(choreId));
}

// Helper to find a member by net_id from appData
function findMember(netId) {
    return appData.members.find(m => m.net_id === netId);
}

// ─── Extension Request Status Helper ──────────────────

function buildExtRequestStatusHTML(requests) {
    if (!requests || requests.length === 0) return '';

    return requests.map(req => {
        const status = String(req.status || '').trim().toLowerCase();
        let icon, label, color, bgColor, borderColor;

        if (status === 'approved') {
            icon = '✅'; label = 'Approved'; color = 'var(--green)';
            bgColor = 'var(--green-bg)'; borderColor = 'var(--green-border)';
        } else if (status === 'denied') {
            icon = '❌'; label = 'Denied'; color = 'var(--cornell-red-light)';
            bgColor = 'rgba(212, 72, 72, 0.1)'; borderColor = 'rgba(212, 72, 72, 0.3)';
        } else {
            icon = '⏳'; label = 'Pending'; color = 'var(--yellow)';
            bgColor = 'rgba(234, 179, 8, 0.1)'; borderColor = 'rgba(234, 179, 8, 0.3)';
        }

        const dateInfo = req.requested_date ? ` until <strong>${formatDateOnly(req.requested_date)}</strong>` : '';
        const reviewReason = req.review_reason ? `<div style="margin-top:4px;font-style:italic;color:var(--text-secondary);">"${req.review_reason}"</div>` : '';
        const reviewedAt = req.reviewed_at && status !== 'pending' ? ` on ${formatDateShort(req.reviewed_at)}` : '';
        const reviewedBy = req.reviewed_by && status !== 'pending' ? `<span style="color:var(--text-muted);"> — reviewed by ${req.reviewed_by}${reviewedAt}</span>` : '';

        return `<div style="margin-top:8px;padding:8px 12px;border-radius:8px;background:${bgColor};border:1px solid ${borderColor};font-size:0.82rem;">
            <span style="font-weight:600;color:${color};">${icon} Extension ${label}</span>${dateInfo}${reviewedBy}
            ${req.reason ? `<div style="margin-top:2px;color:var(--text-secondary);">Your reason: "${req.reason}"</div>` : ''}
            ${reviewReason}
        </div>`;
    }).join('');
}

// Format a date string like "2026-03-01" into "Wed, Mar 1"
function formatDateOnly(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Resident View ────────────────────────────────────

const netidInput = document.getElementById('netid-input');
const netidSubmit = document.getElementById('netid-submit');
const netidError = document.getElementById('netid-error');
const stepChore = document.getElementById('step-chore');
const stepSubtasks = document.getElementById('step-subtasks');
const stepConfirmation = document.getElementById('step-confirmation');
const choreSelectWrapper = document.getElementById('chore-select-wrapper');
const choreSelect = document.getElementById('chore-select');
const choreAssignmentInfo = document.getElementById('chore-assignment-info');
const subtaskList = document.getElementById('subtask-list');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const submitChoreBtn = document.getElementById('submit-chore');

netidSubmit.addEventListener('click', handleNetIdSubmit);
netidInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleNetIdSubmit(); });

async function handleNetIdSubmit() {
    const netId = netidInput.value.trim().toLowerCase();
    if (!netId) {
        netidError.textContent = 'Please enter your Cornell Net ID.';
        return;
    }

    netidError.textContent = '';
    netidSubmit.innerHTML = '<span class="loading-spinner"></span>';

    // Wait for app data to load (handles race condition on first visit)
    await appReady;

    // Find user in loaded data
    const user = appData.members.find(u => u.net_id === netId);
    if (!user) {
        netidError.textContent = `Net ID "${netId}" not found. Please check and try again.`;
        resetSubmitBtn();
        return;
    }

    currentUser = user;

    // Fetch assignments, submissions, and extension requests for the viewed cycle
    const viewCycleId = residentViewCycleId || currentCycleId;
    const [assignRes, subRes, extReqRes] = await Promise.all([
        apiGet('getAssignments', { cycle_id: viewCycleId }),
        apiGet('getSubmissions', { cycle_id: viewCycleId }),
        apiGet('getExtensionRequests', { cycle_id: viewCycleId })
    ]);
    const assignments = assignRes.success ? assignRes.data : [];
    const submissions = subRes.success ? subRes.data : [];
    const extRequests = extReqRes.success ? extReqRes.data : [];
    const assignment = assignments.find(a => a.net_id === netId);
    const userSubmissions = submissions.filter(s => String(s.net_id).trim() === netId);
    const userExtReq = extRequests.filter(r => String(r.net_id).trim().toLowerCase() === netId.toLowerCase());

    // Show resubmit notice if already submitted
    let resubmitNotice = '';
    if (userSubmissions.length > 0) {
        const count = userSubmissions.length;
        resubmitNotice = `<div class="chore-info-card" style="border-left:3px solid var(--accent); margin-top:10px; padding:10px 14px;">
          <div style="font-size:0.82rem; color:var(--text-secondary);">📝 You have <strong>${count}</strong> previous submission${count > 1 ? 's' : ''} this week. Previously completed subtasks are <strong>pre-checked</strong> below — just check off any new items and submit again.</div>
        </div>`;
    }

    if (assignment) {
        const chore = findChore(assignment.chore_id);
        if (chore) {
            choreAssignmentInfo.innerHTML = `
        <div class="chore-info-card">
          <div class="chore-name">${chore.name}</div>
          <div class="chore-detail">Assigned to ${user.name} · ${formatCycleDisplay(viewCycleId)}</div>
          <a href="#" class="ext-request-link${userExtReq.length > 0 ? ' hidden' : ''}" id="request-ext-link">Need more time? Request an extension →</a>
          ${buildExtRequestStatusHTML(userExtReq)}
          <div id="ext-request-form" class="hidden" style="margin-top:10px;">
            <div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
              <div style="flex:1;min-width:150px;">
                <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">Extension until</label>
                <input type="date" id="ext-req-date" style="width:100%;">
              </div>
            </div>
            <textarea id="ext-req-reason" rows="2" placeholder="Why do you need an extension?" style="width:100%;margin-bottom:8px;"></textarea>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary btn-small" id="ext-req-submit">Send Request</button>
              <button class="btn btn-outline btn-small" id="ext-req-cancel">Cancel</button>
            </div>
          </div>
          <div id="ext-request-status" style="margin-top:6px;font-size:0.82rem;"></div>
        </div>${resubmitNotice}`;

            // Show/hide extension request form
            const extLink = document.getElementById('request-ext-link');
            const extForm = document.getElementById('ext-request-form');
            const extDateInput = document.getElementById('ext-req-date');

            // Default date: 2 days from cycle date
            const defaultDate = new Date(viewCycleId + 'T00:00:00');
            defaultDate.setDate(defaultDate.getDate() + 2);
            extDateInput.value = defaultDate.toISOString().split('T')[0];

            extLink.addEventListener('click', (e) => {
                e.preventDefault();
                extLink.classList.add('hidden');
                extForm.classList.remove('hidden');
            });

            document.getElementById('ext-req-cancel').addEventListener('click', () => {
                extForm.classList.add('hidden');
                extLink.classList.remove('hidden');
            });

            document.getElementById('ext-req-submit').addEventListener('click', async () => {
                const reason = document.getElementById('ext-req-reason').value.trim();
                const requestedDate = extDateInput.value;
                if (!reason) { alert('Please provide a reason.'); return; }
                if (!requestedDate) { alert('Please select a date.'); return; }

                const statusEl = document.getElementById('ext-request-status');
                extForm.classList.add('hidden');
                statusEl.innerHTML = '<span class="loading-spinner"></span> Sending request...';
                statusEl.style.color = 'var(--text-secondary)';

                const res = await apiPost('requestExtension', {
                    net_id: netId,
                    cycle_id: viewCycleId,
                    reason: reason,
                    requested_date: requestedDate
                });

                if (res.success) {
                    statusEl.innerHTML = '✓ Extension request sent! Your house manager will review it.';
                    statusEl.style.color = 'var(--green)';
                } else {
                    statusEl.innerHTML = res.error || 'Failed to send request.';
                    statusEl.style.color = 'var(--cornell-red-light)';
                    extForm.classList.remove('hidden');
                }
            });
            currentChore = chore;
            choreSelectWrapper.classList.add('hidden');
            stepChore.classList.remove('hidden');
            loadSubtasks(chore, userSubmissions);
        }
    } else {
        // Not assigned — let them pick a chore
        choreAssignmentInfo.innerHTML = `
      <div class="chore-info-card no-chore">
        <div class="chore-name">No chore assigned</div>
        <div class="chore-detail">${formatCycleDisplay(viewCycleId)} — You can still submit a chore if needed. Select one below:</div>
      </div>${resubmitNotice}`;
        choreSelectWrapper.classList.remove('hidden');

        choreSelect.innerHTML = '<option value="">Select a chore...</option>';
        appData.chores.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.chore_id;
            opt.textContent = c.name;
            choreSelect.appendChild(opt);
        });
        stepChore.classList.remove('hidden');
    }

    resetSubmitBtn();
}

function resetSubmitBtn() {
    netidSubmit.innerHTML = 'Continue <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// Chore selection change (for unassigned residents)
choreSelect.addEventListener('change', () => {
    const choreId = choreSelect.value;
    if (choreId) {
        currentChore = findChore(choreId);
        if (currentChore) loadSubtasks(currentChore);
    } else {
        stepSubtasks.classList.add('hidden');
        currentChore = null;
    }
});

function loadSubtasks(chore, previousSubmissions = []) {
    subtaskList.innerHTML = '';

    if (!chore.subtasks || chore.subtasks.length === 0) {
        subtaskList.innerHTML = '<p style="color:var(--text-muted); font-style:italic;">No subtasks defined for this chore yet. Contact the House Manager.</p>';
        submitChoreBtn.disabled = true;
        stepSubtasks.classList.remove('hidden');
        return;
    }

    // Merge previous subtask checks (OR-merge: if ANY submission checked item N, pre-check it)
    const mergedChecks = new Array(chore.subtasks.length).fill(false);
    previousSubmissions.forEach(sub => {
        try {
            const checks = typeof sub.subtasks_checked_json === 'string'
                ? JSON.parse(sub.subtasks_checked_json)
                : sub.subtasks_checked_json;
            if (Array.isArray(checks)) {
                checks.forEach((val, i) => {
                    if (val && i < mergedChecks.length) mergedChecks[i] = true;
                });
            }
        } catch (e) { /* ignore parse errors */ }
    });

    // Pre-fill notes by combining previous notes
    const previousNotes = previousSubmissions
        .map(s => (s.note || '').trim())
        .filter(n => n.length > 0);
    const noteField = document.getElementById('submission-note');
    if (noteField && previousNotes.length > 0) {
        noteField.value = previousNotes.join(' | ');
    }

    chore.subtasks.forEach((task, idx) => {
        const item = document.createElement('div');
        item.className = 'subtask-item' + (mergedChecks[idx] ? ' checked' : '');
        item.dataset.index = idx;
        item.innerHTML = `
      <div class="subtask-checkbox"></div>
      <div class="subtask-text">${task}</div>`;
        item.addEventListener('click', () => toggleSubtask(item));
        subtaskList.appendChild(item);
    });
    updateProgress(chore.subtasks.length);
    submitChoreBtn.disabled = false;
    stepSubtasks.classList.remove('hidden');
}

function toggleSubtask(item) {
    item.classList.toggle('checked');
    const total = subtaskList.querySelectorAll('.subtask-item').length;
    updateProgress(total);
}

function updateProgress(total) {
    const checked = subtaskList.querySelectorAll('.subtask-item.checked').length;
    const pct = total > 0 ? (checked / total) * 100 : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${checked} / ${total} completed`;
}

// Submit chore
submitChoreBtn.addEventListener('click', handleSubmitChore);

async function handleSubmitChore() {
    if (!currentUser || !currentChore) return;

    const items = subtaskList.querySelectorAll('.subtask-item');
    const subtasksChecked = Array.from(items).map(item => item.classList.contains('checked'));
    const checkedCount = subtasksChecked.filter(Boolean).length;

    if (checkedCount === 0) {
        showToast('Please check off at least one subtask before submitting.', 'error');
        return;
    }

    submitChoreBtn.disabled = true;
    submitChoreBtn.innerHTML = '<span class="loading-spinner"></span> Submitting...';

    const submissionNote = document.getElementById('submission-note').value.trim();

    const result = await apiPost('submitChore', {
        net_id: currentUser.net_id,
        chore_id: currentChore.chore_id,
        subtasks_checked: subtasksChecked,
        cycle_id: residentViewCycleId || currentCycleId,
        note: submissionNote
    });

    if (result.success) {
        const isLate = result.data.is_late;
        const icon = document.getElementById('confirmation-icon');
        const title = document.getElementById('confirmation-title');
        const msg = document.getElementById('confirmation-message');
        const details = document.getElementById('confirmation-details');

        if (isLate) {
            icon.textContent = '⚠️';
            title.textContent = 'Chore Submitted (Late)';
            title.style.color = 'var(--red)';
            msg.innerHTML = `Your submission was recorded <strong style="color:var(--red)">after the Monday ${DEADLINE_DISPLAY} deadline</strong>. You may be subject to a <strong>$20 or $40 fine</strong>. Contact the House Manager if you have an extension.`;
        } else {
            icon.textContent = '✅';
            title.textContent = 'Chore Submitted!';
            title.style.color = 'var(--green)';
            msg.textContent = 'Your submission was recorded on time. Great work!';
        }

        details.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">Resident</span>
        <span class="detail-value">${currentUser.name} (${currentUser.net_id})</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Chore</span>
        <span class="detail-value">${currentChore.name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Subtasks</span>
        <span class="detail-value">${checkedCount} / ${currentChore.subtasks.length} completed</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Submitted</span>
        <span class="detail-value">${formatDate(result.data.submitted_at)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Cycle</span>
        <span class="detail-value">${formatCycleDisplay(result.data.cycle_id)}</span>
      </div>
      ${submissionNote ? `<div class="detail-row">
        <span class="detail-label">Note</span>
        <span class="detail-value" style="font-style:italic">${submissionNote}</span>
      </div>` : ''}`;

        stepSubtasks.classList.add('hidden');
        stepChore.classList.add('hidden');
        document.getElementById('step-netid').classList.add('hidden');
        stepConfirmation.classList.remove('hidden');
        showToast('Chore submitted successfully!', 'success');
        // Refresh the status board to reflect the new submission
        loadHouseStatus();
    } else {
        showToast('Error: ' + (result.error || 'Unknown error'), 'error');
        submitChoreBtn.disabled = false;
        submitChoreBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Submit Chore';
    }
}

function resetResidentView() {
    netidInput.value = '';
    currentUser = null;
    currentChore = null;
    residentViewCycleId = currentCycleId;
    updateResidentCycleNav();
    stepChore.classList.add('hidden');
    stepSubtasks.classList.add('hidden');
    stepConfirmation.classList.add('hidden');
    document.getElementById('step-netid').classList.remove('hidden');
    document.getElementById('submission-note').value = '';
    submitChoreBtn.disabled = true;
    submitChoreBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Submit Chore';
}
window.resetResidentView = resetResidentView;

// ─── House Manager Dashboard ──────────────────────────

const managerLoginBtn = document.getElementById('manager-login-btn');
const managerNetIdInput = document.getElementById('manager-netid-input');
const managerPasswordInput = document.getElementById('manager-password-input');
const managerError = document.getElementById('manager-error');

managerLoginBtn.addEventListener('click', handleManagerLogin);
managerNetIdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') managerPasswordInput.focus(); });
managerPasswordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleManagerLogin(); });

async function handleManagerLogin() {
    const netId = managerNetIdInput.value.trim().toLowerCase();
    const password = managerPasswordInput.value;
    if (!netId) {
        managerError.textContent = 'Please enter your Net ID.';
        return;
    }
    if (!password) {
        managerError.textContent = 'Please enter your password.';
        return;
    }

    managerError.textContent = '';
    managerLoginBtn.innerHTML = '<span class="loading-spinner"></span>';

    // Wait for app data to load (handles race condition on first visit)
    await appReady;

    // Verify credentials server-side (demo mode: accept 'demo' as password)
    if (DEMO_MODE) {
        const user = appData.members.find(u => u.net_id === netId);
        if (!user || (user.role !== 'house_manager' && user.role !== 'president') || password !== 'demo') {
            managerError.textContent = 'Invalid credentials. (Demo password is "demo")';
            managerLoginBtn.innerHTML = 'Access Dashboard <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
            return;
        }
    } else {
        const verifyRes = await apiPost('verifyManager', { net_id: netId, password: password });
        if (!verifyRes.success) {
            managerError.textContent = verifyRes.error || 'Invalid credentials.';
            managerLoginBtn.innerHTML = 'Access Dashboard <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
            return;
        }
    }

    managerNetId = netId;
    document.getElementById('manager-login').classList.add('hidden');
    document.getElementById('dashboard-content').classList.remove('hidden');
    viewingCycleId = currentCycleId;
    document.getElementById('cycle-select').value = currentCycleId;
    await loadDashboard(currentCycleId);
}

// Cycle navigation
document.getElementById('cycle-go').addEventListener('click', async () => {
    const cid = document.getElementById('cycle-select').value.trim();
    if (cid) {
        viewingCycleId = cid;
        await loadDashboard(cid);
    }
});

document.getElementById('cycle-current').addEventListener('click', async () => {
    viewingCycleId = currentCycleId;
    document.getElementById('cycle-select').value = currentCycleId;
    await loadDashboard(currentCycleId);
});

async function loadDashboard(cycleId) {
    const [assignRes, subRes, extReqRes] = await Promise.all([
        apiGet('getAssignments', { cycle_id: cycleId }),
        apiGet('getSubmissions', { cycle_id: cycleId }),
        apiGet('getExtensionRequests', { cycle_id: cycleId })
    ]);

    const residents = appData.members;
    const assignments = assignRes.success ? assignRes.data : [];
    const submissions = subRes.success ? subRes.data : [];
    const extRequests = extReqRes.success ? extReqRes.data : [];

    // Derive extensions from approved requests
    const extensions = extRequests
        .filter(r => String(r.status).trim().toLowerCase() === 'approved')
        .map(r => ({
            net_id: r.net_id,
            cycle_id: r.cycle_id,
            extended_deadline: r.requested_date,
            granted_by: r.reviewed_by || '',
            reason: r.reason || ''
        }));
    const fine = demoFines.find(f =>
        f.net_id === user.net_id &&
        f.cycle_id === cycleId
    );

    // Render pending extension requests panel
    renderExtensionRequests(extRequests, cycleId);

    // Build a merged member list: current residents + anyone in assignments/submissions
    // who isn't a current member (e.g. former residents from History)
    const currentNetIds = new Set(residents.map(r => r.net_id));
    const displayMembers = [...residents];
    assignments.forEach(a => {
        if (!currentNetIds.has(a.net_id)) {
            displayMembers.push({
                net_id: a.net_id,
                name: a.member_name || a.net_id,
                role: 'resident'
            });
            currentNetIds.add(a.net_id);
        }
    });

    // Stats
    const submitted = submissions.length;
    const late = submissions.filter(s => parseInt(s.is_late) === 1).length;
    const assignedNetIds = assignments.map(a => a.net_id);
    const submittedNetIds = submissions.map(s => String(s.net_id).trim());
    const pending = assignedNetIds.filter(id => !submittedNetIds.includes(id)).length;

    document.getElementById('stat-total').textContent = displayMembers.length;
    document.getElementById('stat-submitted').textContent = submitted;
    document.getElementById('stat-late').textContent = late;
    document.getElementById('stat-pending').textContent = pending;

    // Table
    const tbody = document.getElementById('submissions-tbody');
    tbody.innerHTML = '';

    displayMembers.forEach(user => {
        const assignment = assignments.find(a => a.net_id === user.net_id);
        // Get ALL submissions for this user, sorted newest first
        const userSubs = submissions
            .filter(s => String(s.net_id).trim() === user.net_id)
            .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
        const latestSub = userSubs.length > 0 ? userSubs[0] : null;
        const extension = extensions.find(e => String(e.net_id).trim() === user.net_id);
        // Use findChore for full chore data, but fall back to assignment's chore_name from History
        const chore = assignment ? (findChore(assignment.chore_id) || { name: assignment.chore_name, chore_id: assignment.chore_id, subtasks: [] }) : null;

        const tr = document.createElement('tr');

        if (latestSub && parseInt(latestSub.is_late) === 1) {
            tr.classList.add('late-row');
        }

        let statusBadge, timeCell;
        if (!assignment) {
            statusBadge = '<span class="badge badge-unassigned">Unassigned</span>';
            timeCell = '—';
        } else if (latestSub) {
            console.log('Latest submission:', latestSub, 'Reviewed:', latestSub.reviewed);
            const isLate = parseInt(latestSub.is_late) === 1;

            statusBadge = isLate
                ? '<span class="badge badge-late">Late</span>'
                : '<span class="badge badge-submitted">✓ On Time</span>';

            if (latestSub.reviewed) {
                statusBadge += '<span class="badge badge-submitted">✓ Reviewed</span>';
            }
            
            if (fine) {
                statusBadge += `<span class="fine-badge">$${fine.amount} Fine</span>`;
            }
        
            if (userSubs.length > 1) {
                statusBadge += `<span class="badge" style="background:var(--accent);color:#fff;font-size:0.65rem;margin-left:4px;">${userSubs.length}×</span>`;
            }
        
            timeCell = formatDateShort(latestSub.submitted_at);
        } else {
            statusBadge = '<span class="badge badge-pending">Pending</span>';
            timeCell = '—';
        }

        let extInfo = '';
        if (extension) {
            extInfo = `<div class="extension-info">
        <span class="badge badge-extension">Extended to ${formatDateShort(extension.extended_deadline)}</span>
      </div>`;
        }

        tr.innerHTML = `
      <td><strong>${user.name}</strong>${extInfo}</td>
      <td>${user.net_id}</td>
      <td>${chore ? chore.name : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${statusBadge}</td>
      <td>${timeCell}</td>
      <td class="actions-cell">
        ${latestSub ? `<button class="btn btn-view" onclick="viewSubmission('${user.net_id}', '${cycleId}')">Review</button>` : (assignment ? `<button class="btn btn-view btn-outline" onclick="reviewUnsubmitted('${user.net_id}', '${assignment.chore_id}', '${cycleId}')">Review</button>` : '')}
        ${assignment && !extension ? `<button class="btn btn-extend" onclick="openExtensionModal('${user.net_id}', '${user.name}', '${cycleId}')">Extend</button>` : ''}
        ${assignment ? `
            <button class="btn btn-danger btn-small" 
                onclick="sendFineNotification('${user.net_id}', '${user.name.replace(/'/g, "\\'")}', '${chore ? chore.name.replace(/'/g, "\\'") : ''}', '${cycleId}', 20, this)">
                Fine $20
            </button>
            <button class="btn btn-danger btn-small"
                onclick="sendFineNotification('${user.net_id}', '${user.name.replace(/'/g, "\\'")}', '${chore ? chore.name.replace(/'/g, "\\'") : ''}', '${cycleId}', 40, this)">
                Fine $40
            </button>
        ` : ''}
      </td>`;
        tbody.appendChild(tr);
    });
}

// ─── Fine Notification ────────────────────────────────

async function sendFineNotification(netId, memberName, choreName, cycleId, amount, btnEl) {
    const note = prompt(
        `Fine $${amount} for ${memberName} (${netId}) — "${choreName}"\n\nEnter justification note:`
    );
    if (note === null) return;  // user cancelled

    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="loading-spinner"></span>';

    const res = await apiPost('sendFine', {
        net_id: netId,
        member_name: memberName,
        chore_name: choreName,
        fine_amount: amount,
        cycle_id: cycleId,
        granted_by: managerNetId,
        note: note || ''
    });

    if (res.success) {
        btnEl.innerHTML = `✓ $${amount} Sent`;
        btnEl.classList.remove('btn-danger');
        btnEl.classList.add('btn-outline');
        btnEl.style.color = 'var(--green)';
        showToast(`$${amount} fine notification sent for ${memberName}`, 'success');
    } else {
        btnEl.disabled = false;
        btnEl.innerHTML = `Fine $${amount}`;
        showToast(res.error || 'Failed to send fine', 'error');
    }
}

window.sendFineNotification = sendFineNotification;

// ─── Extension Requests Panel ─────────────────────────

function renderExtensionRequests(requests, cycleId) {
    const container = document.getElementById('ext-requests-panel');
    if (!container) return;

    const pending = requests.filter(r => String(r.status).trim().toLowerCase() === 'pending');

    if (pending.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="step-header" style="margin-bottom:12px;">
            <span class="step-number" style="background:var(--accent);">📋</span>
            <h2>Extension Requests <span class="badge badge-pending" style="margin-left:8px;">${pending.length} pending</span></h2>
        </div>
        ${pending.map(req => {
        const member = appData.members.find(m => m.net_id === String(req.net_id).trim());
        const memberName = member ? member.name : req.net_id;
        const timeAgo = formatDateShort(req.requested_at);
        const reqDate = req.requested_date ? `<span class="badge badge-extension" style="margin-left:6px;">Until ${formatDateOnly(req.requested_date)}</span>` : '';
        return `
            <div class="ext-request-card">
                <div class="ext-req-info">
                    <strong>${memberName}</strong> <span style="color:var(--text-muted)">(${req.net_id})</span>${reqDate}
                    <div class="ext-req-reason">"${req.reason}"</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Requested ${timeAgo}</div>
                </div>
                <div class="ext-req-actions">
                    <button class="btn btn-small" style="background:var(--green);color:#fff;" onclick="handleExtReqDecision(${req.id}, 'approved', this)">✓ Approve</button>
                    <button class="btn btn-small btn-outline" style="color:var(--cornell-red-light);border-color:var(--cornell-red-light);" onclick="handleExtReqDecision(${req.id}, 'denied', this)">✕ Deny</button>
                </div>
            </div>`;
    }).join('')}
    `;
}

async function handleExtReqDecision(requestId, decision, btnEl) {
    const label = decision === 'approved' ? 'approving' : 'denying';
    const reviewReason = prompt(`Optional: Add a reason for ${label} this request (or leave blank):`);
    if (reviewReason === null) return; // user cancelled

    const card = btnEl.closest('.ext-request-card');
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';

    const res = await apiPost('approveExtension', {
        request_id: requestId,
        decision: decision,
        reviewed_by: managerNetId,
        review_reason: reviewReason.trim()
    });

    if (res.success) {
        // Animate card out
        card.style.transition = 'all 0.3s';
        card.style.maxHeight = '0';
        card.style.overflow = 'hidden';
        card.style.opacity = '0';
        card.style.margin = '0';
        card.style.padding = '0';
        setTimeout(() => {
            card.remove();
            // Hide panel if no more cards
            const panel = document.getElementById('ext-requests-panel');
            if (panel && !panel.querySelector('.ext-request-card')) {
                panel.classList.add('hidden');
            }
        }, 300);
        showToast(`Extension ${decision}`, decision === 'approved' ? 'success' : 'info');
        // Delay dashboard reload to let sheet update propagate
        setTimeout(() => loadDashboard(viewingCycleId), 1500);
    } else {
        card.style.opacity = '1';
        card.style.pointerEvents = '';
        showToast(res.error || 'Failed to process request', 'error');
    }
}
window.handleExtReqDecision = handleExtReqDecision;

// ─── Extension Modal ──────────────────────────────────

let extensionTarget = null;

function openExtensionModal(netId, name, cycleId) {
    extensionTarget = { netId, cycleId };
    document.getElementById('ext-resident-name').textContent = `${name} (${netId})`;
    document.getElementById('ext-deadline').value = '';
    document.getElementById('ext-reason').value = '';
    document.getElementById('extension-modal').classList.remove('hidden');
}
window.openExtensionModal = openExtensionModal;

document.getElementById('modal-close').addEventListener('click', closeExtensionModal);
document.getElementById('ext-cancel').addEventListener('click', closeExtensionModal);

function closeExtensionModal() {
    document.getElementById('extension-modal').classList.add('hidden');
    extensionTarget = null;
}

document.getElementById('ext-grant').addEventListener('click', async () => {
    if (!extensionTarget) return;
    const deadline = document.getElementById('ext-deadline').value;
    if (!deadline) {
        showToast('Please select a new deadline.', 'error');
        return;
    }

    const result = await apiPost('grantExtension', {
        net_id: extensionTarget.netId,
        cycle_id: extensionTarget.cycleId,
        extended_deadline: new Date(deadline).toISOString(),
        granted_by: managerNetId,
        reason: document.getElementById('ext-reason').value.trim()
    });

    if (result.success) {
        showToast('Extension granted!', 'success');
        closeExtensionModal();
        await loadDashboard(viewingCycleId);
    } else {
        showToast('Error: ' + (result.error || 'Unknown'), 'error');
    }
});

// ─── Subtask Detail Modal ─────────────────────────────

async function viewSubmission(netId, cycleId) {
    const subRes = await apiGet('getSubmissions', { cycle_id: cycleId });
    const submissions = subRes.success ? subRes.data : [];
    // Get ALL submissions for this user, sorted newest first
    const userSubs = submissions
        .filter(s => String(s.net_id).trim() === netId)
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    if (userSubs.length === 0) return;

    const user = findMember(netId);
    const firstSub = userSubs[0];
    const chore = findChore(firstSub.chore_id);
    if (!chore) return;

    document.getElementById('detail-modal-title').textContent =
        `${user ? user.name : netId} — ${chore.name}`;

    let html = '';

    userSubs.forEach((submission, subIdx) => {
        // Parse subtask completion data
        let checked;
        const rawChecked = submission.subtasks_checked_json || submission.subtasks_checked;
        if (typeof rawChecked === 'string') {
            try { checked = JSON.parse(rawChecked); } catch { checked = []; }
        } else if (Array.isArray(rawChecked)) {
            checked = rawChecked;
        } else {
            checked = [];
        }

        const checkedCount = checked.filter(Boolean).length;
        const isLate = parseInt(submission.is_late) === 1;

        // Parse existing manager review if any
        let managerReview = [];
        const rawReview = submission.manager_review_json;
        if (rawReview) {
            if (typeof rawReview === 'string') {
                try { managerReview = JSON.parse(rawReview); } catch { managerReview = []; }
            } else if (Array.isArray(rawReview)) {
                managerReview = rawReview;
            }
        }
        const hasExistingReview = managerReview.length > 0;
        const existingReviewReason = submission.review_reason || '';

        // Add a separator between multiple submissions
        if (subIdx > 0) {
            html += '<hr style="border:none; border-top:1px solid rgba(255,255,255,0.08); margin:20px 0;">';
        }

        // Submission header
        const label = userSubs.length > 1 ? `Submission ${userSubs.length - subIdx} of ${userSubs.length}` : '';
        html += `
    <div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
      ${label ? `<span style="font-weight:600; font-size:0.82rem; color:var(--text-secondary);">${label}</span>` : ''}
      <span class="badge ${isLate ? 'badge-late' : 'badge-submitted'}">${isLate ? 'Late' : '✓ On Time'}</span>
      ${isLate ? '<span class="fine-badge">$40 Fine</span>' : ''}
      ${hasExistingReview ? '<span class="badge" style="background:var(--accent);color:#fff;">Reviewed</span>' : ''}
      <span style="color:var(--text-muted); font-size:0.82rem;">
        Submitted: ${formatDate(submission.submitted_at)} · ${checkedCount}/${chore.subtasks.length} subtasks
      </span>
    </div>

    <table class="review-table" data-sub-id="${submission.id}" style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="text-align:left; padding:8px; color:var(--text-muted); font-weight:600;">Subtask</th>
          <th style="text-align:center; padding:8px; color:var(--text-muted); font-weight:600; width:70px;">Resident</th>
          <th style="text-align:center; padding:8px; color:var(--text-muted); font-weight:600; width:100px;">Manager Review</th>
        </tr>
      </thead>
      <tbody>`;

        chore.subtasks.forEach((task, i) => {
            const residentDone = checked[i];
            const mgrChecked = hasExistingReview ? managerReview[i] === true : residentDone;
            html += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px; color:var(--text-primary);">${task}</td>
          <td style="text-align:center; padding:8px;">${residentDone ? '✅' : '⬜'}</td>
          <td style="text-align:center; padding:8px;">
            <input type="checkbox" name="review-${submission.id}-${i}" ${mgrChecked ? 'checked' : ''} id="rcb-${submission.id}-${i}" style="display:none;">
            <span onclick="var cb=document.getElementById('rcb-${submission.id}-${i}');cb.checked=!cb.checked;this.textContent=cb.checked?'✅':'⬜';" style="cursor:pointer;font-size:1.1rem;user-select:none;">${mgrChecked ? '✅' : '⬜'}</span>
          </td>
        </tr>`;
        });

        html += `</tbody></table>`;

        // Show note if present
        const note = submission.note || '';
        if (note) {
            html += `<div style="margin-top:12px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:10px; border-left:3px solid var(--accent);">
          <div style="font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">📝 Resident Note</div>
          <div style="font-size:0.88rem; color:var(--text-secondary); font-style:italic;">${note}</div>
        </div>`;
        }

        // Review reason + Save button (only for the latest submission)
        if (subIdx === 0) {
            const escapedName = (user ? user.name : netId).replace(/'/g, "\\'");
            const escapedChore = chore.name.replace(/'/g, "\\'");
            html += `
    <div style="margin-top:16px; padding:14px 16px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.08);">
      <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:6px;">Manager Review Notes (optional)</label>
      <textarea id="review-reason-input" rows="2" placeholder="e.g. Bathroom floor still dirty, trash not taken out..." style="width:100%; margin-bottom:10px; font-size:0.85rem;">${existingReviewReason.replace(/^\[.*?\]\s*/, '')}</textarea>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-primary btn-small" id="save-review-btn" onclick="saveManagerReview(${submission.id}, ${chore.subtasks.length})">💾 Save Review</button>
        <button class="btn btn-email btn-small" onclick="sendReviewEmail('${netId}', '${escapedName}', '${escapedChore}', ${submission.id}, ${chore.subtasks.length}, '${cycleId}', this)">📧 Email Review</button>
        <button class="btn btn-danger btn-small" onclick="modalFine('${netId}', '${escapedName}', '${escapedChore}', '${cycleId}', 20, this)">Fine $20</button>
        <button class="btn btn-danger btn-small" onclick="modalFine('${netId}', '${escapedName}', '${escapedChore}', '${cycleId}', 40, this)">Fine $40</button>
        <span id="review-save-status" style="font-size:0.82rem;"></span>
      </div>
    </div>`;
        }
    });

    document.getElementById('detail-modal-body').innerHTML = html;
    document.getElementById('detail-modal').classList.remove('hidden');
}
window.viewSubmission = viewSubmission;

async function saveManagerReview(submissionId, subtaskCount) {
    const reviewChecks = [];
    for (let i = 0; i < subtaskCount; i++) {
        const cb = document.querySelector(`input[name="review-${submissionId}-${i}"]`);
        reviewChecks.push(cb ? cb.checked : false);
    }

    const reviewReason = document.getElementById('review-reason-input').value.trim();
    const btn = document.getElementById('save-review-btn');
    const statusEl = document.getElementById('review-save-status');

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    statusEl.textContent = '';

    const res = await apiPost('reviewSubmission', {
        submission_id: submissionId,
        review_checks: reviewChecks,
        review_reason: reviewReason,
        reviewed_by: managerNetId
    });

    if (res.success) {
        btn.innerHTML = '💾 Save Review';
        btn.disabled = false;
        statusEl.innerHTML = '<span style="color:var(--green);">✓ Review saved</span>';
        showToast('Review saved successfully', 'success');
    } else {
        btn.innerHTML = '💾 Save Review';
        btn.disabled = false;
        statusEl.innerHTML = `<span style="color:var(--cornell-red-light);">${res.error || 'Failed to save'}</span>`;
        showToast(res.error || 'Failed to save review', 'error');
    }
}
window.saveManagerReview = saveManagerReview;

async function sendReviewEmail(netId, memberName, choreName, submissionId, subtaskCount, cycleId, btnEl) {
    // Collect current review state from the modal
    const subtasks = [];
    const table = document.querySelector(`table[data-sub-id="${submissionId}"]`);
    if (table) {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row, i) => {
            const cells = row.querySelectorAll('td');
            const name = cells[0] ? cells[0].textContent.trim() : `Subtask ${i + 1}`;
            const residentDone = cells[1] ? cells[1].textContent.trim() === '✅' : false;
            const cb = document.querySelector(`input[name="review-${submissionId}-${i}"]`);
            const managerDone = cb ? cb.checked : false;
            subtasks.push({ name, resident: residentDone, manager: managerDone });
        });
    }

    const reviewReason = document.getElementById('review-reason-input')?.value.trim() || '';

    btnEl.disabled = true;
    const origText = btnEl.innerHTML;
    btnEl.innerHTML = '<span class="loading-spinner"></span> Sending...';

    const res = await apiPost('sendReviewEmail', {
        net_id: netId,
        member_name: memberName,
        chore_name: choreName,
        subtasks: subtasks,
        review_reason: reviewReason,
        reviewed_by: managerNetId,
        cycle_id: cycleId
    });

    if (res.success) {
        btnEl.innerHTML = '✓ Sent';
        btnEl.style.cssText = 'background:var(--green);color:#fff;pointer-events:none;';
        showToast(`Review emailed to ${res.data.sent_to}`, 'success');
    } else {
        btnEl.disabled = false;
        btnEl.innerHTML = origText;
        showToast(res.error || 'Failed to send email', 'error');
    }
}
window.sendReviewEmail = sendReviewEmail;


async function modalFine(netId, memberName, choreName, cycleId, amount, btnEl) {
    const note = prompt(
        `Fine $${amount} for ${memberName} — "${choreName}"\n\nReason (e.g. "chore not actually completed"):`,
        'Chore not completed satisfactorily'
    );
    if (note === null) return;

    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="loading-spinner"></span>';

    const res = await apiPost('sendFine', {
        net_id: netId,
        member_name: memberName,
        chore_name: choreName,
        fine_amount: amount,
        cycle_id: cycleId,
        granted_by: managerNetId,
        note: note || ''
    });

    if (res.success) {
        btnEl.innerHTML = `✓ $${amount} Fine Sent`;
        btnEl.classList.remove('btn-danger');
        btnEl.style.cssText = 'background:var(--green);color:#fff;pointer-events:none;';
        showToast(`$${amount} fine sent to ${memberName}`, 'success');
    } else {
        btnEl.disabled = false;
        btnEl.innerHTML = `Fine $${amount}`;
        showToast(res.error || 'Failed to send fine', 'error');
    }
}
window.modalFine = modalFine;

// ─── Review Unsubmitted Chore ─────────────────────────

async function reviewUnsubmitted(netId, choreId, cycleId) {
    const user = findMember(netId);
    const chore = findChore(choreId);
    if (!chore) { showToast('Chore not found', 'error'); return; }

    document.getElementById('detail-modal-title').textContent =
        `${user ? user.name : netId} — ${chore.name}`;

    let html = '';

    // Header: no submission
    html += `
    <div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
      <span class="badge badge-pending">No Submission</span>
      <span style="color:var(--text-muted); font-size:0.82rem;">Resident has not submitted this chore yet</span>
    </div>

    <table class="review-table" data-sub-id="unsub-${netId}" style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="text-align:left; padding:8px; color:var(--text-muted); font-weight:600;">Subtask</th>
          <th style="text-align:center; padding:8px; color:var(--text-muted); font-weight:600; width:70px;">Resident</th>
          <th style="text-align:center; padding:8px; color:var(--text-muted); font-weight:600; width:100px;">Manager Review</th>
        </tr>
      </thead>
      <tbody>`;

    chore.subtasks.forEach((task, i) => {
        html += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px; color:var(--text-primary);">${task}</td>
          <td style="text-align:center; padding:8px;">⬜</td>
          <td style="text-align:center; padding:8px;">
            <input type="checkbox" name="review-unsub-${netId}-${i}" id="rcb-unsub-${netId}-${i}" style="display:none;">
            <span onclick="var cb=document.getElementById('rcb-unsub-${netId}-${i}');cb.checked=!cb.checked;this.textContent=cb.checked?'✅':'⬜';" style="cursor:pointer;font-size:1.1rem;user-select:none;">⬜</span>
          </td>
        </tr>`;
    });

    html += `</tbody></table>`;

    const escapedName = (user ? user.name : netId).replace(/'/g, "\\'");
    const escapedChore = chore.name.replace(/'/g, "\\'");

    html += `
    <div style="margin-top:16px; padding:14px 16px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.08);">
      <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:6px;">Manager Review Notes (optional)</label>
      <textarea id="review-reason-input" rows="2" placeholder="e.g. Chore was not completed at all..." style="width:100%; margin-bottom:10px; font-size:0.85rem;"></textarea>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button class="btn btn-primary btn-small" id="save-review-btn" onclick="saveUnsubmittedReview('${netId}', '${choreId}', '${cycleId}', ${chore.subtasks.length})">
                💾 Save Review
            </button>
        
            <button class="btn btn-email btn-small" id="email-unsub-review-btn" onclick="emailUnsubmittedReview('${netId}', '${escapedName}', '${escapedChore}', '${cycleId}', ${chore.subtasks.length}, this)">
                📧 Email Review
            </button>
        
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn btn-danger btn-small"
                    onclick="modalFine('${netId}', '${escapedName}', '${escapedChore}', '${cycleId}', 20, this)">
                    Fine $20
                </button>
        
                <button class="btn btn-danger btn-small"
                    onclick="modalFine('${netId}', '${escapedName}', '${escapedChore}', '${cycleId}', 40, this)">
                    Fine $40
                </button>
            </div>
        
            <span id="review-save-status" style="font-size:0.82rem; color:var(--green);"></span>
        </div>
    </div>`;

    document.getElementById('detail-modal-body').innerHTML = html;
    document.getElementById('detail-modal').classList.remove('hidden');
}
window.reviewUnsubmitted = reviewUnsubmitted;

async function saveUnsubmittedReview(netId, choreId, cycleId, subtaskCount) {
    const reviewChecks = [];
    for (let i = 0; i < subtaskCount; i++) {
        const cb = document.querySelector(`input[name="review-unsub-${netId}-${i}"]`);
        reviewChecks.push(cb ? cb.checked : false);
    }

    const reviewReason = document.getElementById('review-reason-input').value.trim();
    const btn = document.getElementById('save-review-btn');
    const statusEl = document.getElementById('review-save-status');

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    statusEl.textContent = '';

    const res = await apiPost('reviewUnsubmitted', {
        net_id: netId,
        chore_id: choreId,
        cycle_id: cycleId,
        review_checks: reviewChecks,
        review_reason: reviewReason,
        reviewed_by: managerNetId
    });

    if (res.success) {
        btn.innerHTML = '✓ Review Saved';
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');

        statusEl.innerHTML = '<span style="color:var(--green);">✓ Reviewed</span>';

        showToast('Review saved successfully', 'success');

        // Reload dashboard so the row now shows as submitted
        setTimeout(() => loadDashboard(viewingCycleId), 1500);
    } else {
        btn.innerHTML = '💾 Save Review';
        btn.disabled = false;
        statusEl.innerHTML = `<span style="color:var(--cornell-red-light);">${res.error || 'Failed to save'}</span>`;
        showToast(res.error || 'Failed to save review', 'error');
    }
}
window.saveUnsubmittedReview = saveUnsubmittedReview;

async function emailUnsubmittedReview(netId, memberName, choreName, cycleId, subtaskCount, btnEl) {
    const chore = appData.chores.find(c => {
        const assignment = appData.members.find(m => m.net_id === netId);
        return c.name === choreName || c.chore_id === arguments[5]; // fallback
    });

    const subtasks = [];
    for (let i = 0; i < subtaskCount; i++) {
        const table = document.querySelector(`table[data-sub-id="unsub-${netId}"]`);
        const rows = table ? table.querySelectorAll('tbody tr') : [];
        if (rows[i]) {
            const cells = rows[i].querySelectorAll('td');
            const name = cells[0] ? cells[0].textContent.trim() : `Subtask ${i + 1}`;
            const cb = document.querySelector(`input[name="review-unsub-${netId}-${i}"]`);
            const managerDone = cb ? cb.checked : false;
            subtasks.push({ name, resident: false, manager: managerDone });
        }
    }

    const reviewReason = document.getElementById('review-reason-input')?.value.trim() || '';

    btnEl.disabled = true;
    const origText = btnEl.innerHTML;
    btnEl.innerHTML = '<span class="loading-spinner"></span> Sending...';

    const res = await apiPost('sendReviewEmail', {
        net_id: netId,
        member_name: memberName,
        chore_name: choreName,
        subtasks: subtasks,
        review_reason: reviewReason,
        reviewed_by: managerNetId,
        cycle_id: cycleId
    });

    if (res.success) {
        btnEl.innerHTML = '✓ Sent';
        btnEl.style.cssText = 'background:var(--green);color:#fff;pointer-events:none;';
        showToast(`Review emailed to ${res.data.sent_to}`, 'success');
    } else {
        btnEl.disabled = false;
        btnEl.innerHTML = origText;
        showToast(res.error || 'Failed to send email', 'error');
    }
}
window.emailUnsubmittedReview = emailUnsubmittedReview;

document.getElementById('detail-modal-close').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.add('hidden');
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });
});

// ─── House Chore Status Board (Public) ────────────────

async function loadHouseStatus() {
    const viewCycleId = residentViewCycleId || currentCycleId;
    if (!viewCycleId) return;

    const listEl = document.getElementById('status-board-list');
    if (!listEl) return;

    // Show loading state
    listEl.innerHTML = '<div class="status-board-loading"><span class="loading-spinner"></span> Loading status…</div>';

    await appReady;

    const [assignRes, subRes] = await Promise.all([
        apiGet('getAssignments', { cycle_id: viewCycleId }),
        apiGet('getSubmissions', { cycle_id: viewCycleId })
    ]);

    const assignments = assignRes.success ? assignRes.data : [];
    const submissions = subRes.success ? subRes.data : [];

    if (assignments.length === 0) {
        listEl.innerHTML = '<div class="status-board-empty">No chore assignments found for this week.</div>';
        document.getElementById('status-stat-done').textContent = '0';
        document.getElementById('status-stat-remaining').textContent = '0';
        document.getElementById('status-stat-late-count').textContent = '0';
        document.getElementById('status-progress-bar').style.width = '0%';
        // Update subtitle with cycle display
        const subtitleEl = document.querySelector('.status-board-subtitle');
        if (subtitleEl) subtitleEl.textContent = `${formatCycleDisplay(viewCycleId)} — No assignments found.`;
        return;
    }

    // Build status per assigned member
    const submittedNetIds = new Set(submissions.map(s => String(s.net_id).trim()));
    const lateNetIds = new Set(
        submissions.filter(s => parseInt(s.is_late) === 1).map(s => String(s.net_id).trim())
    );

    let doneCount = 0;
    let lateCount = 0;
    let pendingCount = 0;

    // Sort: pending first, then late, then done
    const sortedAssignments = [...assignments].sort((a, b) => {
        const aSub = submittedNetIds.has(a.net_id);
        const bSub = submittedNetIds.has(b.net_id);
        const aLate = lateNetIds.has(a.net_id);
        const bLate = lateNetIds.has(b.net_id);

        // Pending first
        if (!aSub && bSub) return -1;
        if (aSub && !bSub) return 1;
        // Late before on-time
        if (aLate && !bLate) return -1;
        if (!aLate && bLate) return 1;
        // Alphabetical
        return (a.member_name || '').localeCompare(b.member_name || '');
    });

    let html = '';

    sortedAssignments.forEach(assignment => {
        const member = findMember(assignment.net_id) || { name: assignment.member_name || assignment.net_id, net_id: assignment.net_id };
        const chore = findChore(assignment.chore_id) || { name: assignment.chore_name || 'Unknown Chore' };
        const hasSubmitted = submittedNetIds.has(assignment.net_id);
        const isLate = lateNetIds.has(assignment.net_id);

        // Get initials for avatar
        const nameParts = member.name.split(' ');
        const initials = nameParts.length >= 2
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0])
            : member.name.substring(0, 2);

        let statusClass, badgeHtml;
        if (hasSubmitted && isLate) {
            statusClass = 'status-late-item';
            badgeHtml = '<span class="badge badge-late">Late</span>';
            lateCount++;
        } else if (hasSubmitted) {
            statusClass = 'status-done';
            badgeHtml = '<span class="badge badge-submitted">✓ Done</span>';
            doneCount++;
        } else {
            statusClass = 'status-pending-item';
            badgeHtml = '<span class="badge badge-pending">Pending</span>';
            pendingCount++;
        }

        // Make submitted items clickable to view subtasks
        const clickAttr = hasSubmitted
            ? `onclick="viewPublicSubmission('${assignment.net_id}', '${viewCycleId}')" style="cursor:pointer;"`
            : `title="No submission yet"`;
        const chevron = hasSubmitted
            ? '<svg class="status-board-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
            : '';

        html += `
        <div class="status-board-item ${statusClass}${hasSubmitted ? ' clickable' : ''}" ${clickAttr}>
            <div class="status-board-avatar">${initials}</div>
            <div class="status-board-info">
                <div class="status-board-name">${member.name}</div>
                <div class="status-board-chore">${chore.name}</div>
            </div>
            <div class="status-board-badge">${badgeHtml}${chevron}</div>
        </div>`;
    });

    listEl.innerHTML = html;

    // Update stats
    document.getElementById('status-stat-done').textContent = doneCount;
    document.getElementById('status-stat-remaining').textContent = pendingCount;
    document.getElementById('status-stat-late-count').textContent = lateCount;

    // Update progress bar
    const total = assignments.length;
    const pct = total > 0 ? ((doneCount + lateCount) / total) * 100 : 0;
    document.getElementById('status-progress-bar').style.width = `${pct}%`;

    // Update subtitle
    const subtitleEl = document.querySelector('.status-board-subtitle');
    if (subtitleEl) subtitleEl.textContent = `${formatCycleDisplay(viewCycleId)} — ${doneCount + lateCount} of ${total} submitted`;
}

// ─── Public Subtask Viewer (read-only, no manager controls) ──

async function viewPublicSubmission(netId, cycleId) {
    const subRes = await apiGet('getSubmissions', { cycle_id: cycleId });
    const submissions = subRes.success ? subRes.data : [];
    const userSubs = submissions
        .filter(s => String(s.net_id).trim() === netId)
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    if (userSubs.length === 0) return;

    const user = findMember(netId);
    const firstSub = userSubs[0];
    const chore = findChore(firstSub.chore_id);
    if (!chore) return;

    document.getElementById('detail-modal-title').textContent =
        `${user ? user.name : netId} — ${chore.name}`;

    let html = '';

    userSubs.forEach((submission, subIdx) => {
        // Parse subtask completion data
        let checked;
        const rawChecked = submission.subtasks_checked_json || submission.subtasks_checked;
        if (typeof rawChecked === 'string') {
            try { checked = JSON.parse(rawChecked); } catch { checked = []; }
        } else if (Array.isArray(rawChecked)) {
            checked = rawChecked;
        } else {
            checked = [];
        }

        const checkedCount = checked.filter(Boolean).length;
        const isLate = parseInt(submission.is_late) === 1;
        const totalSubtasks = chore.subtasks ? chore.subtasks.length : checked.length;
        const pct = totalSubtasks > 0 ? Math.round((checkedCount / totalSubtasks) * 100) : 0;

        // Separator between multiple submissions
        if (subIdx > 0) {
            html += '<hr style="border:none; border-top:1px solid rgba(255,255,255,0.08); margin:20px 0;">';
        }

        // Submission header
        const label = userSubs.length > 1 ? `Submission ${userSubs.length - subIdx} of ${userSubs.length}` : '';
        html += `
    <div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
      ${label ? `<span style="font-weight:600; font-size:0.82rem; color:var(--text-secondary);">${label}</span>` : ''}
      <span class="badge ${isLate ? 'badge-late' : 'badge-submitted'}">${isLate ? 'Late' : '✓ On Time'}</span>
      <span style="color:var(--text-muted); font-size:0.82rem;">
        Submitted: ${formatDate(submission.submitted_at)} · ${checkedCount}/${totalSubtasks} subtasks (${pct}%)
      </span>
    </div>

    <div class="public-subtask-progress" style="margin-bottom:14px;">
      <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:10px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, ${isLate ? 'var(--red)' : 'var(--green)'}, ${isLate ? '#ef4444' : '#16a34a'}); border-radius:10px; transition:width 0.4s ease;"></div>
      </div>
    </div>`;

        // Subtask list (read-only)
        if (chore.subtasks && chore.subtasks.length > 0) {
            chore.subtasks.forEach((task, i) => {
                const done = checked[i];
                html += `
        <div style="display:flex; align-items:flex-start; gap:10px; padding:10px 14px; margin-bottom:4px; border-radius:8px; background:${done ? 'rgba(34, 197, 94, 0.06)' : 'rgba(255,255,255,0.02)'}; border:1px solid ${done ? 'var(--green-border)' : 'var(--border-subtle)'};">
          <span style="font-size:1.1rem; flex-shrink:0; margin-top:1px;">${done ? '✅' : '⬜'}</span>
          <span style="font-size:0.85rem; line-height:1.5; color:${done ? 'var(--text-primary)' : 'var(--text-muted)'}; ${done ? '' : 'opacity:0.7;'}">${task}</span>
        </div>`;
            });
        }

        // Show note if present
        const note = submission.note || '';
        if (note) {
            html += `<div style="margin-top:12px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:10px; border-left:3px solid var(--accent);">
          <div style="font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">📝 Note</div>
          <div style="font-size:0.88rem; color:var(--text-secondary); font-style:italic;">${note}</div>
        </div>`;
        }
    });

    document.getElementById('detail-modal-body').innerHTML = html;
    document.getElementById('detail-modal').classList.remove('hidden');
}
window.viewPublicSubmission = viewPublicSubmission;

// ─── Start ────────────────────────────────────────────

async function startApp() {
    await initApp();
    loadHouseStatus();
}

startApp();
