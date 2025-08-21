/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}", // or whatever path your HTML file is in
    "./*.html", // This is important if your HTML file is in the root
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}