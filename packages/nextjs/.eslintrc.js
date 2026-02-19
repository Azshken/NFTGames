module.exports = {
  // ... existing config
  rules: {
    // ... existing rules
    "prettier/prettier": ["warn", {}, { usePrettierrc: true }],
  },
  overrides: [
    {
      // Disable the file-header enforcement specifically for Next.js page files
      files: ["app/**/*.tsx", "app/**/*.ts"],
      rules: {
        "check-file/filename-naming-convention": "off",
      },
    },
  ],
};