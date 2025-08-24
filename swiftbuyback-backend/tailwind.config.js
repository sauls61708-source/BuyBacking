/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // This is the key part. It tells Tailwind to scan your HTML file.
    "./public/admin.html", 
    
    // If you add other files later, you'll put them here.
    // For example, if you add a JavaScript file for dynamic content:
    // "./src/js/**/*.js"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}