// Editor smoke test for the Shortwind TS plugin. Open this FOLDER in VS Code or
// Cursor, run "TypeScript: Select TypeScript Version → Use Workspace Version",
// then try each numbered spot below. (Nothing here needs to build/run.)

export function Demo() {
  return (
    <div className="@stack-md">
      {/* 1. COMPLETION — click between the quotes and type `@` (a list of the
          project's recipes should appear: @badge, @btn-primary, @stack-md, …). */}
      <div className="@"></div>

      {/* 2. HOVER — mouse over @badge: a tooltip shows its full Tailwind
          expansion (inline-flex items-center … bg-[var(--tone-bg,…)] …). */}
      <span className="@badge">Hover me</span>

      {/* 3. DIAGNOSTIC + QUICK-FIX — @badeg is misspelled. Expect a warning
          squiggle and a lightbulb: "Change '@badeg' to '@badge'". */}
      <span className="@badeg">Fix me</span>

      {/* 4. GO-TO-DEFINITION — F12 (or Cmd/Ctrl-click) on @btn-primary jumps
          straight to its @recipe block in recipes/button.css. */}
      <button className="@btn-primary ">Save</button>

      {/* 5. NO FALSE POSITIVES — Tailwind v4's own @-utilities are left alone
          (no "unknown recipe" squiggle on these). */}
      <div className="@container @md:flex @min-[400px]:grid">untouched</div>
    </div>
  );
}
