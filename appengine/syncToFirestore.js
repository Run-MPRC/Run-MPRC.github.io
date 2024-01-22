/**
 * Synchronizes member data from a Google Sheet to Firestore and updates their roles.
 * This function retrieves member data assigned by the current year Google Sheet e.g '2024' or '2025',
 * identifies members whose roles need updating, and makes a POST request to
 * a cloud function to update these roles in Firestore. Additionally, it updates
 * the Google Sheet to reflect the changes made.
 *
 * Google Sheet (needs to permission to access)
 * https://docs.google.com/spreadsheets/d/1buqvvrzg14i5G5bCndVVXRqXMWPMrUQ-vuGtrSw4i1A
 * */
function syncToFirestoreAndUpdateRoles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('2024');
  const range = sheet.getDataRange();
  const values = range.getValues();

  const cloudFunctionUrl = 'https://us-central1-runmprc-97922.cloudfunctions.net/updateMemberRole';
  const apiKey = 'your_secret_api_key'; // Replace with your actual API key

  // Collect rows where column C is TRUE
  const emailsToUpdate = [];
  values.forEach((row, index) => {
    if (index === 0 || row[2] !== true) return; // Skip header row and rows where column C is not TRUE
    emailsToUpdate.push({ email: row[1], rowIndex: index + 1 });
  });

  if (emailsToUpdate.length > 0) {
    const emailsArray = emailsToUpdate.map((entry) => entry.email);
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ apiKey, emails: emailsArray }),
    };

    try {
      const response = UrlFetchApp.fetch(
        `${cloudFunctionUrl}?apiKey=${encodeURIComponent(apiKey)}`,
        options,
      );
      Logger.log(response.getContentText());

      // Update the 'inserted' column in the sheet to TRUE for these emails
      emailsToUpdate.forEach((entry) => {
        sheet.getRange(entry.rowIndex, 4).setValue(true); // Column D is 4th column
      });
    } catch (error) {
      Logger.log(`Error calling Cloud Function: ${error}`);
    }
  } else {
    Logger.log('No emails to update');
  }
}
