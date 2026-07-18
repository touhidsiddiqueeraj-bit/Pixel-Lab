---
name: Bug Report
about: Report something that's broken or behaving unexpectedly
title: "[Bug] "
labels: bug, needs-triage
assignees: ''
---

## Bug Description

<!-- A clear and concise description of what the bug is. -->

## Steps to Reproduce

1.
2.
3.

## Expected Behavior

<!-- What you expected to happen. -->

## Actual Behavior

<!-- What actually happened. -->

## Environment

- **Pixel Lab version**: <!-- e.g. git commit hash or release tag -->
- **Browser**: <!-- e.g. Chrome 128, Firefox 130, Safari 17 -->
- **OS**: <!-- e.g. macOS 14, Windows 11, Ubuntu 24.04 -->
- **Device tier**: <!-- Low / Medium / High (see the FPS counter popover) -->
- **Did the issue involve the AI Agent?**: <!-- Yes / No -->

## Screenshots / Recordings

<!-- If applicable, drag screenshots or screen recordings here. -->

## Console Output

<!-- Open DevTools → Console, copy any red errors here. -->

```
Paste console output here
```

## Additional Context

<!-- Add any other context about the problem here. -->

---

### For AI Agent bugs specifically

If the bug is in the AI Agent panel, please also include:

- **Model used**: <!-- Flash-Lite / Flash / Pro -->
- **The prompt you typed**: <!-- exact text -->
- **Did the tool-call chip show?**: <!-- Yes / No -->
- **Did the preview appear?**: <!-- Yes / No -->
- **Did you click Accept or Reject?**: <!-- Accept / Reject / Neither -->

**Security note:** Do NOT paste your Gemini API key anywhere in this issue. The key is never logged or sent anywhere except Google's API — if you see it in the console, that's a bug worth reporting, but redact the key itself.
