import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const TASK_TYPES = {
  video: "צפייה בסרטון",
  lecture: "הרצאה",
  assignment: "מטלה",
  quiz: "בוחן",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const state = {
  user: null,
  sharedCourses: [],
  sharedTasks: [],
  personalCourses: [],
  personalTasks: [],
  doneTaskIds: {},
};

const signInBtn = document.getElementById("sign-in-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const authStatus = document.getElementById("auth-status");
const courseForm = document.getElementById("course-form");
const courseNameInput = document.getElementById("course-name");
const courseScopeSelect = document.getElementById("course-scope");
const taskForm = document.getElementById("task-form");
const taskCourseSelect = document.getElementById("task-course");
const taskTitleInput = document.getElementById("task-title");
const taskTypeSelect = document.getElementById("task-type");
const taskDeadlineDateInput = document.getElementById("task-deadline-date");
const taskDeadlineTimeInput = document.getElementById("task-deadline-time");
const taskScopeSelect = document.getElementById("task-scope");
const filterCourse = document.getElementById("filter-course");
const filterStatus = document.getElementById("filter-status");
const filterType = document.getElementById("filter-type");
const taskList = document.getElementById("task-list");
const stats = document.getElementById("stats");
const taskTemplate = document.getElementById("task-item-template");
const icsInput = document.getElementById("ics-input");
const importIcsBtn = document.getElementById("import-ics-btn");

const activeUnsubs = [];

wireEvents();
startSharedListeners();
render();

onAuthStateChanged(auth, (user) => {
  clearUserListeners();
  state.user = user;

  if (user) {
    authStatus.textContent = `מחובר כ: ${user.displayName || user.email || "משתמש"}`;
    startUserListeners(user.uid);
  } else {
    authStatus.textContent = "לא מחובר. התחבר כדי לסנכרן מעקב אישי בין מכשירים.";
    state.personalCourses = [];
    state.personalTasks = [];
    state.doneTaskIds = {};
    render();
  }
});

function wireEvents() {
  signInBtn.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      alert("ההתחברות נכשלה. נסה שוב.");
    }
  });

  signOutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch {
      alert("ההתנתקות נכשלה.");
    }
  });

  courseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) {
      alert("צריך להתחבר כדי להוסיף קורסים.");
      return;
    }

    const name = courseNameInput.value.trim();
    if (!name) return;

    if (courseScopeSelect.value === "shared") {
      await addDoc(collection(db, "sharedCourses"), { name });
    } else {
      await addDoc(collection(db, `users/${state.user.uid}/personalCourses`), { name });
    }

    courseNameInput.value = "";
  });

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) {
      alert("צריך להתחבר כדי להוסיף משימות.");
      return;
    }

    const title = taskTitleInput.value.trim();
    const courseId = taskCourseSelect.value;
    const type = taskTypeSelect.value;
    const deadline = buildDeadlineValue(taskDeadlineDateInput.value, taskDeadlineTimeInput.value);
    const scope = taskScopeSelect.value;

    if (!title || !courseId) return;

    if (scope === "shared") {
      const duplicate = findSimilarSharedTask(title, courseId);
      if (duplicate) {
        const shouldContinue = confirm(
          `קיימת משימה דומה: "${duplicate.title}". האם להוסיף בכל זאת?`
        );
        if (!shouldContinue) return;
      }

      await addDoc(collection(db, "sharedTasks"), {
        title,
        courseId,
        type,
        deadline,
        normalizedTitle: normalizeText(title),
      });
    } else {
      await addDoc(collection(db, `users/${state.user.uid}/personalTasks`), {
        title,
        courseId,
        type,
        deadline,
      });
    }

    taskTitleInput.value = "";
    taskDeadlineDateInput.value = "";
    taskDeadlineTimeInput.value = "";
  });

  filterCourse.addEventListener("change", renderTaskList);
  filterStatus.addEventListener("change", renderTaskList);
  filterType.addEventListener("change", renderTaskList);

  importIcsBtn.addEventListener("click", async () => {
    if (!state.user) {
      alert("צריך להתחבר לפני ייבוא מ‑Moodle.");
      return;
    }

    const file = icsInput.files?.[0];
    if (!file) {
      alert("יש לבחור קובץ ICS קודם.");
      return;
    }

    const content = await file.text();
    const events = parseIcsEvents(content);
    if (!events.length) {
      alert("לא זוהו אירועים בקובץ.");
      return;
    }

    const allCourses = getAllCourses();
    let importedCount = 0;

    for (const event of events) {
      if (!event.summary) continue;

      let courseId = taskCourseSelect.value;
      if (event.courseName) {
        const existing = allCourses.find((course) => course.name === event.courseName);
        if (existing) {
          courseId = existing.id;
        } else {
          const created = await addDoc(collection(db, `users/${state.user.uid}/personalCourses`), {
            name: event.courseName,
          });
          courseId = created.id;
        }
      }

      await addDoc(collection(db, `users/${state.user.uid}/personalTasks`), {
        title: event.summary,
        courseId,
        type: inferTaskType(event.summary),
        deadline: event.startDate || null,
      });
      importedCount += 1;
    }

    alert(`יובאו ${importedCount} משימות אישיות.`);
  });
}

function startSharedListeners() {
  activeUnsubs.push(
    onSnapshot(query(collection(db, "sharedCourses")), (snapshot) => {
      state.sharedCourses = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
        source: "shared",
      }));
      render();
    })
  );

  activeUnsubs.push(
    onSnapshot(query(collection(db, "sharedTasks")), (snapshot) => {
      state.sharedTasks = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
        source: "shared",
      }));
      render();
    })
  );
}

function startUserListeners(uid) {
  activeUnsubs.push(
    onSnapshot(query(collection(db, `users/${uid}/personalCourses`)), (snapshot) => {
      state.personalCourses = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
        source: "personal",
      }));
      render();
    })
  );

  activeUnsubs.push(
    onSnapshot(query(collection(db, `users/${uid}/personalTasks`)), (snapshot) => {
      state.personalTasks = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
        source: "personal",
      }));
      render();
    })
  );

  activeUnsubs.push(
    onSnapshot(query(collection(db, `users/${uid}/progress`)), (snapshot) => {
      const done = {};
      snapshot.forEach((item) => {
        const value = item.data();
        if (value.done) done[item.id] = true;
      });
      state.doneTaskIds = done;
      render();
    })
  );
}

function clearUserListeners() {
  while (activeUnsubs.length > 2) {
    const unsub = activeUnsubs.pop();
    unsub();
  }
}

function render() {
  renderCourseSelects();
  renderTaskList();
}

function renderCourseSelects() {
  const allCourses = getAllCourses();
  taskCourseSelect.innerHTML = allCourses.length
    ? allCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.name)}</option>`).join("")
    : `<option value="">אין קורסים זמינים</option>`;

  filterCourse.innerHTML = [
    `<option value="all">כל הקורסים</option>`,
    ...allCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.name)}</option>`),
  ].join("");
}

function renderTaskList() {
  const tasks = getAllTasks();
  const filtered = tasks.filter((task) => {
    if (filterCourse.value !== "all" && task.courseId !== filterCourse.value) return false;
    if (filterStatus.value === "done" && !isTaskDone(task.id)) return false;
    if (filterStatus.value === "pending" && isTaskDone(task.id)) return false;
    if (filterType.value !== "all" && task.type !== filterType.value) return false;
    return true;
  });

  const doneCount = tasks.filter((task) => isTaskDone(task.id)).length;
  stats.textContent = `השלמת ${doneCount} מתוך ${tasks.length} משימות.`;

  taskList.innerHTML = "";
  if (!filtered.length) {
    taskList.innerHTML = `<li class="empty">אין משימות להצגה בפילטר הנוכחי.</li>`;
    return;
  }

  filtered
    .sort((a, b) => {
      const aTime = deadlineToTimestamp(a.deadline);
      const bTime = deadlineToTimestamp(b.deadline);
      return aTime - bTime;
    })
    .forEach((task) => {
      const course = getAllCourses().find((item) => item.id === task.courseId);
      const fragment = taskTemplate.content.cloneNode(true);

      const doneInput = fragment.querySelector(".task-done");
      const title = fragment.querySelector(".task-title");
      const meta = fragment.querySelector(".task-meta");
      const calendarBtn = fragment.querySelector(".calendar-btn");
      const deleteBtn = fragment.querySelector(".delete-btn");

      doneInput.checked = isTaskDone(task.id);
      doneInput.disabled = !state.user;
      title.textContent = task.title;

      const deadlineText = formatDeadline(task.deadline);
      const sourceText = task.source === "shared" ? "משימה משותפת" : "משימה אישית";
      meta.textContent = `${course?.name ?? "קורס לא ידוע"} | ${TASK_TYPES[task.type]} | ${deadlineText} | ${sourceText}`;

      doneInput.addEventListener("change", async () => {
        if (!state.user) return;
        await setDoc(doc(db, `users/${state.user.uid}/progress/${task.id}`), {
          done: doneInput.checked,
          updatedAt: new Date().toISOString(),
        });
      });

      deleteBtn.disabled = !state.user || task.source === "shared";
      if (task.source === "shared") {
        deleteBtn.textContent = "משותפת";
      }

      deleteBtn.addEventListener("click", async () => {
        if (!state.user || task.source === "shared") return;

        await deleteDoc(doc(db, `users/${state.user.uid}/personalTasks/${task.id}`));
        await deleteDoc(doc(db, `users/${state.user.uid}/progress/${task.id}`));
      });

      calendarBtn.addEventListener("click", () => {
        const url = buildGoogleCalendarUrl(task, course?.name);
        window.open(url, "_blank", "noopener,noreferrer");
      });

      taskList.appendChild(fragment);
    });
}

function findSimilarSharedTask(title, courseId) {
  const normalized = normalizeText(title);
  return state.sharedTasks.find((task) => {
    if (task.courseId !== courseId) return false;
    const taskTitle = task.normalizedTitle || normalizeText(task.title || "");
    return taskTitle.includes(normalized) || normalized.includes(taskTitle);
  });
}

function normalizeText(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function getAllCourses() {
  return [...state.sharedCourses, ...state.personalCourses];
}

function getAllTasks() {
  return [...state.sharedTasks, ...state.personalTasks];
}

function isTaskDone(taskId) {
  return Boolean(state.doneTaskIds[taskId]);
}


function buildDeadlineValue(dateValue, timeValue) {
  if (!dateValue) return null;
  if (!timeValue) return dateValue;
  return `${dateValue}T${timeValue}`;
}

function deadlineToTimestamp(deadline) {
  if (!deadline) return Number.MAX_SAFE_INTEGER;
  const value = parseDeadlineToDate(deadline).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function parseDeadlineToDate(deadline) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return new Date(`${deadline}T09:00`);
  }
  return new Date(deadline);
}

function formatDeadline(deadline) {
  if (!deadline) return "ללא תאריך יעד";

  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return `תאריך יעד: ${new Date(`${deadline}T00:00`).toLocaleDateString("he-IL")}`;
  }

  return `תאריך יעד: ${new Date(deadline).toLocaleString("he-IL", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function parseIcsEvents(content) {
  const normalized = content.replace(/\r\n[ \t]/g, "");
  const lines = normalized.split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith("SUMMARY:")) {
      current.summary = line.slice(8).trim();
      current.courseName = extractCourseName(current.summary);
    } else if (line.startsWith("DTSTART")) {
      const [, value = ""] = line.split(":");
      current.startDate = parseIcsDate(value);
    }
  }

  return events;
}

function extractCourseName(summary) {
  const match = summary.match(/\[(.*?)\]/);
  return match ? match[1].trim() : null;
}

function inferTaskType(summary) {
  const normalized = summary.toLowerCase();
  if (normalized.includes("quiz") || normalized.includes("בחן") || normalized.includes("מבחן")) return "quiz";
  if (normalized.includes("assignment") || normalized.includes("מטלה") || normalized.includes("הגשה")) return "assignment";
  if (normalized.includes("lecture") || normalized.includes("הרצאה")) return "lecture";
  return "video";
}

function parseIcsDate(value) {
  if (!value) return null;
  const compact = value.replace("Z", "");
  if (compact.length < 8) return null;

  const year = compact.slice(0, 4);
  const month = compact.slice(4, 6);
  const day = compact.slice(6, 8);
  const hour = compact.slice(9, 11) || "09";
  const minute = compact.slice(11, 13) || "00";
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildGoogleCalendarUrl(task, courseName = "קורס") {
  const title = `${task.title} (${courseName})`;
  const start = task.deadline ? parseDeadlineToDate(task.deadline) : new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const dates = `${toGoogleDate(start)}/${toGoogleDate(end)}`;

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("dates", dates);
  url.searchParams.set("details", `משימה מסוג ${TASK_TYPES[task.type]}`);
  return url.toString();
}

function toGoogleDate(date) {
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  return iso.slice(0, 15) + "Z";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function ensureCollectionsExist() {
  const sharedCoursesSnap = await getDocs(query(collection(db, "sharedCourses")));
  if (!sharedCoursesSnap.empty) return;

  await addDoc(collection(db, "sharedCourses"), { name: "אנטומיה א" });
}

ensureCollectionsExist();
