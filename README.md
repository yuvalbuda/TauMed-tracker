# Student Performance Tracker

אפליקציית ווב שיתופית לניהול משימות תואר:
- מאגר קורסים ומשימות **משותף לכל התואר**
- מעקב השלמה **אישי ומסונכרן** לכל משתמש
- אפשרות להוסיף גם משימות אישיות לניהול כללי

## פיצ'רים מרכזיים
- התחברות עם Google דרך Firebase Auth
- סנכרון בין מכשירים עם Firestore
- הוספת קורס/משימה כ-`משותף` או `אישי`
- התראת כפילות בעת יצירת משימה משותפת דומה
- ייבוא משימות אישיות מקובץ Moodle `ICS`
- פתיחת אירוע ב-Google Calendar בלחיצה

## הגדרת Firebase
1. פתח [Firebase Console](https://console.firebase.google.com/).
2. צור פרויקט חדש.
3. הפעל Authentication -> Sign-in method -> Google.
4. צור Firestore Database (במצב Production או Test לפי הצורך).
5. צור Web App וקבל את ערכי הקונפיגורציה.
6. עדכן את הקובץ `firebase-config.js` עם הערכים שקיבלת.

## Firestore Collections
- `sharedCourses` - קורסים משותפים לכולם
- `sharedTasks` - משימות משותפות לכולם
- `users/{uid}/personalCourses` - קורסים אישיים
- `users/{uid}/personalTasks` - משימות אישיות
- `users/{uid}/progress` - סטטוס done אישי לכל משימה

## פריסה ל-GitHub Pages
1. העלה את התיקייה לריפו GitHub.
2. ב-GitHub עבור אל `Settings -> Pages`.
3. בחר `Deploy from a branch` ו-`main` + `/root`.
4. אשר ושמור.

## הערה חשובה
לפני הפריסה, ודא ש-`Authorized domains` ב-Firebase Authentication כולל את דומיין GitHub Pages שלך.
