// generate-env-var.js
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

try {
    const rawData = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(rawData);

    // Crucial fix: Replace actual newline characters with the escaped string "\\n"
    // This ensures that when the entire object is stringified, the private_key
    // is a single line in the JSON string, but correctly represents newlines.
    serviceAccount.private_key = serviceAccount.private_key.replace(/\n/g, '\\n');

    // Stringify the entire object. JSON.stringify will handle escaping inner quotes correctly.
    const jsonString = JSON.stringify(serviceAccount);

    // Print the export command
    console.log(`export FIREBASE_SERVICE_ACCOUNT_CONFIG='${jsonString}'`);
    console.log("\nCopy the above line and paste it into your terminal.");

} catch (error) {
    console.error("Error generating environment variable command:", error);
    console.error("Please ensure 'serviceAccountKey.json' is in the same directory.");
}
