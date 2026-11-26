# Accessibility review

AIRWISE targets WCAG 2.2 AA. This report separates automated rule scans from keyboard and responsive checks; passing a scan is not a certification.

## Implemented support

- Semantic landmarks, a single dashboard `h1`, section headings, labelled navigation, explicit labels for forms, and accessible names for icon-only controls.
- A skip-to-main-content link, visible keyboard focus, Escape-to-close dialogs, focus trapping/restoration, and keyboard-operable navigation and forms.
- Text labels accompany AQI and source states; status is not conveyed by colour alone. Form errors use `role="alert"`; changing request status and notices use status announcements.
- Dialogs identify their title and description. The assistant conversation uses a labelled live log and announces busy status.
- Responsive layouts are exercised at 390, 768, and 1440 CSS pixels. Main interactive controls meet or exceed the 24 CSS-pixel WCAG 2.2 AA target size; key controls are at least 42 CSS pixels high.
- `prefers-reduced-motion` disables nonessential transitions and scrolling animation.

## Verification evidence

- `e2e/accessibility.spec.ts` ran nine axe-core scans: WCAG 2.0/2.1/2.2 A and AA rules on the dashboard and each modal at all three configured viewports. All nine scans passed with zero violations.
- `e2e/dashboard.spec.ts` covers keyboard skip navigation, dialog focus trapping/restoration, mobile navigation, responsive overflow, and accessible field labels.
- Manual review checked visible focus styling, textual status labels, heading order, input labels, dialog naming, and reduced-motion handling in the implementation.

Automated tools cannot determine whether all wording is understandable or every screen-reader/browser combination behaves correctly. Screen-reader testing across assistive technologies remains a separate manual task.
