/* BASE Health Report: the clinic store's connection details (v13).
   apiKey and projectId come from the Firebase console (Project settings › Your apps › firebaseConfig). They are public
   identifiers, not secrets: the clinic login and the Firestore rules are what protect the records.
   Both empty = local mode: no sign-in, records stay on this device as before. */
window.BH_CLOUD = window.BH_CLOUD || { apiKey: 'AIzaSyD6h7TBB6KXn3lODdlLAyZqbZ8iyhO3pQQ', projectId: 'base-health-report' };
