# Waiver Flow State Machine

## Overview

The waiver flow gates access to the Join Us page content. Users must acknowledge the waiver (via embedded Google Form) before viewing membership information.

## State Machine Diagram

```mermaid
stateDiagram-v2
    [*] --> CheckLocalStorage: User navigates to /joinus

    CheckLocalStorage --> WaiverSigned: waiverSigned === 'true'
    CheckLocalStorage --> WaiverNotSigned: waiverSigned !== 'true'

    WaiverNotSigned --> DisplayWaiverForm: Render Waiver component

    state DisplayWaiverForm {
        [*] --> FormVisible
        FormVisible --> UserFillsForm: User interacts with Google Form
        UserFillsForm --> FormSubmitted: User submits in iframe
        FormSubmitted --> WaitingAcknowledge: Form submitted
    }

    DisplayWaiverForm --> AcknowledgeClicked: User clicks "I Have Submitted the Waiver"

    AcknowledgeClicked --> SetLocalStorage: Set waiverSigned = 'true'
    SetLocalStorage --> ShowContinueButton: hasSubmitted = true

    ShowContinueButton --> ContinueClicked: User clicks "Continue to Join Us Page"

    ContinueClicked --> TriggerCallback: Call onWaiverSubmit()
    TriggerCallback --> ScrollToTop: window.scrollTo(top)
    ScrollToTop --> UpdateParentState: setHasSignedWaiver(true)

    WaiverSigned --> DisplayJoinUsContent: Render JoinUs component
    UpdateParentState --> DisplayJoinUsContent

    DisplayJoinUsContent --> [*]: User views membership info
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant JoinUsConditionalRoute
    participant Waiver
    participant LocalStorage
    participant GoogleForm
    participant JoinUs

    User->>Browser: Navigate to /joinus
    Browser->>JoinUsConditionalRoute: Render route
    JoinUsConditionalRoute->>LocalStorage: Check waiverSigned

    alt waiverSigned === 'true'
        LocalStorage-->>JoinUsConditionalRoute: true
        JoinUsConditionalRoute->>JoinUs: Render JoinUs
        JoinUs-->>User: Display membership content
    else waiverSigned !== 'true'
        LocalStorage-->>JoinUsConditionalRoute: false/null
        JoinUsConditionalRoute->>Waiver: Render Waiver
        Waiver-->>User: Display embedded Google Form

        User->>GoogleForm: Fill and submit form
        GoogleForm-->>User: Form submitted (in iframe)

        User->>Waiver: Click "I Have Submitted the Waiver"
        Waiver->>LocalStorage: Set waiverSigned = 'true'
        Waiver-->>User: Show "Continue to Join Us Page" button

        User->>Waiver: Click "Continue to Join Us Page"
        Waiver->>JoinUsConditionalRoute: onWaiverSubmit()
        JoinUsConditionalRoute->>Browser: scrollTo(top)
        JoinUsConditionalRoute->>JoinUs: Render JoinUs
        JoinUs-->>User: Display membership content
    end
```

## Component Flow Diagram

```mermaid
flowchart TD
    A[User visits /joinus] --> B{Check localStorage}
    B -->|waiverSigned = true| C[Render JoinUs]
    B -->|waiverSigned = false/null| D[Render Waiver]

    D --> E[Display embedded Google Form]
    E --> F[User fills form in iframe]
    F --> G[User clicks 'I Have Submitted the Waiver']
    G --> H[Set localStorage waiverSigned = true]
    H --> I[Log analytics event]
    I --> J[Show 'Continue' button]
    J --> K[User clicks 'Continue to Join Us Page']
    K --> L[Call onWaiverSubmit callback]
    L --> M[Scroll to top]
    M --> N[Set hasSignedWaiver = true]
    N --> C

    C --> O[Display membership info]
    C --> P[Display RRCA announcement]
    C --> Q[Display member benefits]

    style D fill:#ff9
    style C fill:#9f9
```

## States Description

| State | Description |
|-------|-------------|
| `CheckLocalStorage` | Initial check for existing waiver acknowledgment |
| `WaiverNotSigned` | User has not previously acknowledged waiver |
| `DisplayWaiverForm` | Show embedded Google Form in iframe |
| `AcknowledgeClicked` | User clicked the acknowledge button |
| `SetLocalStorage` | Persist waiver status to localStorage |
| `ShowContinueButton` | Display button to proceed |
| `WaiverSigned` | User has acknowledged waiver (current or previous session) |
| `DisplayJoinUsContent` | Show full Join Us page content |

## localStorage Keys

| Key | Type | Description |
|-----|------|-------------|
| `waiverSigned` | `'true'` \| `null` | Whether user acknowledged waiver |

## Components Involved

### JoinUsConditionalRoute.jsx

```jsx
// Manages waiver gate state
const [hasSignedWaiver, setHasSignedWaiver] = useState(false);

useEffect(() => {
  const waiverSigned = localStorage.getItem('waiverSigned');
  setHasSignedWaiver(waiverSigned === 'true');
}, []);

// Conditional render
{hasSignedWaiver ? <JoinUs /> : <Waiver onWaiverSubmit={onWaiverSubmit} />}
```

### Waiver.jsx

```jsx
// Two-step acknowledgment
const [hasSubmitted, setHasSubmitted] = useState(false);

const handleFormSubmit = () => {
  localStorage.setItem('waiverSigned', 'true');
  setHasSubmitted(true);
};

const handleContinue = () => {
  onWaiverSubmit();  // Callback to parent
};
```

## Edge Cases

1. **localStorage disabled**: Falls back to showing waiver each visit
2. **Form not actually submitted**: User can still acknowledge (honor system)
3. **Cleared browser data**: User must re-acknowledge waiver
4. **Multiple tabs**: localStorage syncs across tabs on next visit

## Analytics Events

| Event | Trigger | Data |
|-------|---------|------|
| `signed_waiver` | User clicks acknowledge button | `{ signed: true }` |
