# AIRWISE INDIA Design System

## Design rationale

AIRWISE is an environmental information product for everyday decisions. Its interface puts the verified measurement and its limits first, then connects that information to practical guidance. The visual language uses editorial type, forest green, warm neutral surfaces, and restrained borders so the experience feels calm and useful without relying on decorative charts or high-alert styling.

The unavailable AQI state is treated as an information state: it shows a dash, explains that no official index was verified, identifies the CPCB source, and gives the user a next step. Errors and setup states keep their own labels. OpenAQ remains a separate supplementary measurement source. No visual state invents readings or turns raw pollutant values into AQI.

The interface uses the installed system font stack (`Inter` when available, followed by platform UI fonts). No font package, remote font request, or other UI dependency was added.

## Colour tokens

| Token | Value | Use |
| --- | --- | --- |
| `--forest` | `#173F35` | Brand, primary dark actions, prominent headings |
| `--green` | `#286C57` | Links, active states, focus outline |
| `--green-soft` | `#E8F1EA` | Context panels and active navigation |
| `--green-pale` | `#F1F6F1` | Hover and secondary surfaces |
| `--warm` | `#F8F7F2` | Page background |
| `--surface` | `#FFFFFF` | Cards, dialogs, inputs |
| `--ink` | `#172C28` | Primary text |
| `--muted` | `#53665F` | Body and supporting text |
| `--quiet` | `#60726B` | Secondary metadata |
| `--border` | `#DCE5DE` | Dividers and card outlines |
| `--border-strong` | `#C8D5CC` | Form and control outlines |
| `--accent` | `#D99A48` | Warm AQI panel edge and caution accent |
| `--success` / `--success-bg` | `#27613E` / `#E9F4EC` | Verified/success state |
| `--warning` / `--warning-bg` | `#80500D` / `#FFF3DB` | Stale or caution state |
| `--neutral` / `--neutral-bg` | `#53635C` / `#EEF1EE` | Unavailable or setup state |
| `--error` / `--error-bg` | `#8C372D` / `#FBECEA` | Error state |

Status labels include text and a marker; status is not conveyed by colour alone. Primary text and links use dark colors on light surfaces. The quiet text token was adjusted to `#60726B`, which has a 4.76:1 contrast ratio on the warm page surface and 5.10:1 on white in the sRGB contrast calculation used during this iteration. The warm accent is used decoratively and is not used as small text on white. Recheck contrast whenever colors change.

## Typography

The scale uses sentence case and comfortable line heights. The root body size is 16px. Headings scale with viewport width, while supporting metadata is kept distinct from core recommendation copy.

| Role | Desktop | Mobile | Notes |
| --- | --- | --- | --- |
| Page heading | `clamp(36px, 4.2vw, 52px)` | `clamp(34px, 8.5vw, 39px)` | Short editorial line length |
| Section heading | 31px | 26px | Clear separation from card titles |
| Card heading | 20–25px | 19–23px | Specific action or data label |
| Body | 16–18px | 16px | Main explanations and practical steps |
| Supporting text | 14–15px | 14–15px | Context and secondary descriptions |
| Metadata | 13px minimum | 13px minimum | Source, timestamp, freshness, basis |

## Component conventions

- **Navigation:** AIRWISE INDIA brand, Overview, Your plan, Ask AIRWISE, plus location and preferences actions. The active section is indicated by a filled soft-green tab. On narrow screens, those actions move into a labeled menu button.
- **AQI overview:** Official CPCB provenance stays in the card footer. A numeric AQI appears only for an explicitly verified value. The unavailable state uses a dash, status text, explanation, location action, and refresh action; it does not render a decorative gauge.
- **Pollutant readings:** Six named observations are shown in a grid. Value, unit, time, source, stale state, and unavailable text remain attached to each observation. They are explicitly labeled raw readings, not AQI.
- **Daily plan:** Standard deterministic guidance is labeled separately from AI answers. The plan follows morning/outdoor decisions, commute, workday/indoor routines, and evening planning in that order. Every recommendation retains its reason, intended profile, preference evidence where applicable, practical steps, expected benefit, and expandable basis. Environmental impact copy contains no unsourced numeric estimate.
- **Indoor coach:** A distinct soft-green section presents the existing indoor recommendation and its practical steps, benefit, and data basis. It does not assert unsupported health outcomes.
- **OpenAQ:** Supplementary sensor data remains separate from the official CPCB panel and retains station-specific measurement times.
- **Assistant:** A clear three-step introduction explains the AIRWISE workflow beside a source-aware conversation panel with the selected area in view. Starter questions send directly, and the composer remains visible below the conversation. Replies use a single vertical content column so answer text, source labels, and recommendation cards stay readable at every width. Provider attribution appears only for a validated provider answer.
- **Dialogs:** Location and preference forms have semantic labels, descriptions, keyboard focus containment, Escape dismissal, and focus restoration. Preferences are optional and remain in browser storage under the existing behavior.

## Layout and responsive rules

- Content max width is 1280px (`--content-width`), with fluid page gutters.
- At widths above 820px, the desktop navigation and multi-column layouts are available. Tablet widths use smaller overview columns and reorganized content grids.
- At 820px and below, navigation becomes a mobile menu, the main overview becomes a single column, and the assistant becomes a stacked layout.
- At 620px and below, the pollutant grid uses two columns and recommendation, dialog, and assistant content becomes single-column. Assistant messages and recommendation cards never form horizontally compressed columns. Controls keep at least 44px targets.
- The dashboard was captured at 390×844, 768×1024, and 1440×900. A Playwright assertion checks for horizontal page overflow at those configured viewports.
- Motion is limited to small state transitions and scrolling. `prefers-reduced-motion: reduce` disables smooth scrolling and reduces animation/transition duration.

## Accessibility decisions

- Page and section landmarks have labels/headings; status and loading updates use text and status semantics.
- Location, preferences, navigation, and assistant controls are buttons or links with accessible names and form labels.
- Keyboard focus is visible with a 3px outline. Dialogs trap focus while open, close on Escape, and return focus to the opener.
- Status text accompanies status color; the AQI value is announced as official only when present.
- Text uses sentence case, body copy remains at least 16px, supporting labels use 14–15px, and metadata is at least 13px.
- System reduced-motion preferences are honored.

These are implementation choices, not a formal WCAG conformance certification or a substitute for assistive-technology user testing.
