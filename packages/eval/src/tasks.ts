// The eval task set. Each task is a small, unambiguous UI request whose
// natural solution leans on recipes that have easy-to-confuse neighbours —
// exactly the cases the @guide blocks were written to disambiguate.
//
// `confusables` lists the wrong-but-tempting name an agent tends to reach for
// and the recipe it should use instead. The offline simulator uses these to
// model the hypothesis; the grader does NOT — it scores real output against
// the real registry, so a model that invents a different wrong name is still
// caught.

export type Confusable = {
  wrong: string;
  right: string;
};

export type EvalTask = {
  id: string;
  title: string;
  prompt: string;
  // Recipes a good answer is expected to use (drives the offline simulator's
  // "correct" output; informational for real runs).
  recipes: string[];
  confusables: Confusable[];
};

export const TASKS: EvalTask[] = [
  {
    id: "pricing-card",
    title: "Pricing card",
    prompt:
      "A pricing card: a heading, a large price, a short description line, and a primary call-to-action button. Make the whole card a raised, slightly emphasized surface.",
    recipes: ["card-elevated", "heading-md", "muted", "btn-primary"],
    confusables: [
      { wrong: "card-raised", right: "card-elevated" },
      { wrong: "h3", right: "heading-md" },
      { wrong: "muted-text", right: "muted" },
    ],
  },
  {
    id: "login-form",
    title: "Login form",
    prompt:
      "A login form with an email field and a password field, each with a label and the inputs, plus a 'remember me' checkbox row and a full-width submit button.",
    recipes: ["field", "label", "input", "checkbox", "btn-primary"],
    confusables: [
      { wrong: "form-group", right: "field" },
      { wrong: "form-input", right: "input" },
      { wrong: "form-checkbox", right: "checkbox" },
    ],
  },
  {
    id: "dashboard-sidebar",
    title: "Dashboard sidebar",
    prompt:
      "A vertical dashboard sidebar with a title and three navigation links, one of which is the active page. Stack the links with a small gap.",
    recipes: ["stack-md", "nav", "nav-link", "nav-link-active"],
    confusables: [
      { wrong: "flex-col", right: "stack-md" },
      { wrong: "sidebar-layout", right: "stack-md" },
    ],
  },
  {
    id: "users-table",
    title: "Users table",
    prompt:
      "A users table with header cells and body rows that highlight on hover. Wrap it so it scrolls horizontally on small screens.",
    recipes: ["table-container", "table", "th", "td", "tr-hover"],
    confusables: [
      { wrong: "table-wrapper", right: "table-container" },
      { wrong: "table-row-hover", right: "tr-hover" },
    ],
  },
  {
    id: "toolbar",
    title: "Button toolbar",
    prompt:
      "A horizontal toolbar of buttons: a primary action, a secondary action, and a ghost button, laid out in a centered row with a gap.",
    recipes: ["row", "btn-primary", "btn-secondary", "btn-ghost"],
    confusables: [
      { wrong: "flex-row", right: "row" },
      { wrong: "flex-center", right: "row" },
    ],
  },
  {
    id: "feature-grid",
    title: "Feature grid",
    prompt:
      "A three-column responsive grid of feature cards. Each card has a small heading and a line of body text.",
    recipes: ["grid-3", "card", "heading-sm", "body"],
    confusables: [
      { wrong: "grid-cols-3", right: "grid-3" },
      { wrong: "body-text", right: "body" },
    ],
  },
  {
    id: "alert-stack",
    title: "Alert stack",
    prompt:
      "A vertical stack of three alerts — one success, one warning, one danger — with a medium gap between them.",
    recipes: ["stack-md", "alert-success", "alert-warning", "alert-danger"],
    confusables: [
      { wrong: "flex-col", right: "stack-md" },
      { wrong: "alert-error", right: "alert-danger" },
    ],
  },
  {
    id: "empty-state",
    title: "Empty state",
    prompt:
      "An empty-state panel for a list with no items: an icon slot, a title, a supporting description line, and a primary button to add the first item.",
    recipes: ["empty", "empty-icon", "empty-title", "empty-description", "btn-primary"],
    confusables: [
      { wrong: "empty-state", right: "empty" },
      { wrong: "empty-subtitle", right: "empty-description" },
    ],
  },
  {
    id: "profile-header",
    title: "Profile header",
    prompt:
      "A profile header: a large round avatar next to a name heading and a muted handle line, arranged in a centered row.",
    recipes: ["row", "avatar-lg", "heading-md", "muted"],
    confusables: [
      { wrong: "flex-row", right: "row" },
      { wrong: "avatar-large", right: "avatar-lg" },
    ],
  },
  {
    id: "modal-confirm",
    title: "Confirm dialog",
    prompt:
      "A confirmation modal: a dimmed overlay, a centered panel with a header title, a body line, and a footer with a cancel ghost button and a danger confirm button.",
    recipes: ["dialog-overlay", "dialog", "dialog-content", "dialog-header", "dialog-footer", "btn-ghost", "btn-danger"],
    confusables: [
      { wrong: "modal-overlay", right: "dialog-overlay" },
      { wrong: "modal-content", right: "dialog-content" },
    ],
  },
  {
    id: "stat-cards",
    title: "Stat cards",
    prompt:
      "A row of three stat cards inside a centered page container. Each card shows a caption label and a large number.",
    recipes: ["container", "grid-3", "card", "caption"],
    confusables: [
      { wrong: "container-lg", right: "container" },
      { wrong: "grid-cols-3", right: "grid-3" },
    ],
  },
  {
    id: "tag-list",
    title: "Status badges",
    prompt:
      "An inline list of status badges: one neutral, one success, one danger, and one outline-only badge.",
    recipes: ["badge", "badge-success", "badge-danger", "badge-outline"],
    confusables: [
      { wrong: "badge-default", right: "badge" },
      { wrong: "badge-error", right: "badge-danger" },
    ],
  },
];
