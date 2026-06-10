// Representative agent-authored component files used by `shortwind bench`.
// Every @recipe here resolves against the bundled catalog — the corpus doubles
// as a check that the recipes an agent naturally reaches for actually exist.
export const CORPUS_FILES: Record<string, string> = {
  "button.tsx": `export function ButtonShowcase() {
  return (
    <div className="@row gap-4 p-6">
      <button className="@btn-primary">Primary Button</button>
      <button className="@btn-primary-sm">Small Primary</button>
      <button className="@btn-primary-lg">Large Primary</button>
      <button className="@btn-secondary">Secondary Button</button>
      <button className="@btn-outline">Outline Button</button>
      <button className="@btn-ghost">Ghost Button</button>
      <button className="@btn-danger">Danger Button</button>
    </div>
  );
}`,

  "card.tsx": `export function ProductCard() {
  return (
    <div className="@card-interactive max-w-sm">
      <div className="@card-header">
        <h3 className="@heading-md">Premium Product</h3>
        <span className="@badge-success">In Stock</span>
      </div>
      <div className="@card-body">
        <p className="@body">
          This is a beautiful product description. It uses multiple utility classes and shortwind recipes to keep output clean and readable for agents.
        </p>
        <div className="@row-between mt-4">
          <span className="text-2xl font-bold">$99.99</span>
          <span className="@muted">Save 20%</span>
        </div>
      </div>
      <div className="@card-footer">
        <button className="@btn-secondary-sm">View Details</button>
        <button className="@btn-primary-sm">Buy Now</button>
      </div>
    </div>
  );
}`,

  "form.tsx": `export function LoginForm() {
  return (
    <div className="@card max-w-md mx-auto p-8">
      <h2 className="@heading-lg mb-6 text-center">Welcome Back</h2>
      <form className="@stack-md">
        <div className="@field">
          <label className="@label" htmlFor="email">Email Address</label>
          <input className="@input" id="email" type="email" placeholder="you@example.com" required />
          <span className="@help">We will never share your email.</span>
        </div>
        <div className="@field">
          <label className="@label" htmlFor="password">Password</label>
          <input className="@input" id="password" type="password" required />
        </div>
        <div className="@row gap-2">
          <input className="@checkbox" id="remember" type="checkbox" />
          <label className="@label" htmlFor="remember">Remember me</label>
        </div>
        <button className="@btn-primary w-full mt-4" type="submit">Sign In</button>
      </form>
    </div>
  );
}`,

  "table.tsx": `export function UsersTable() {
  return (
    <div className="@table-container">
      <table className="@table">
        <thead>
          <tr className="bg-muted/50">
            <th className="@th">User</th>
            <th className="@th">Status</th>
            <th className="@th">Role</th>
            <th className="@th">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr className="@tr-hover">
            <td className="@td font-medium">Alice Johnson</td>
            <td className="@td"><span className="@badge-success">Active</span></td>
            <td className="@td">Administrator</td>
            <td className="@td"><button className="@btn-ghost-sm">Edit</button></td>
          </tr>
          <tr className="@tr-hover">
            <td className="@td font-medium">Bob Smith</td>
            <td className="@td"><span className="@badge-warning">Pending</span></td>
            <td className="@td">Editor</td>
            <td className="@td"><button className="@btn-ghost-sm">Edit</button></td>
          </tr>
          <tr className="@tr-hover">
            <td className="@td font-medium">Charlie Brown</td>
            <td className="@td"><span className="@badge-danger">Suspended</span></td>
            <td className="@td">Subscriber</td>
            <td className="@td"><button className="@btn-ghost-sm">Edit</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}`,

  "layout.tsx": `export function DashboardLayout({ children }) {
  return (
    <div className="@row min-h-screen items-stretch bg-background">
      <aside className="@stack-md w-64 border-r border-border bg-card p-4">
        <div className="flex h-12 items-center px-2 font-bold text-lg">
          Shortwind Console
        </div>
        <nav className="@nav flex-col items-stretch">
          <a className="@nav-link-active" href="/dashboard">Dashboard</a>
          <a className="@nav-link" href="/analytics">Analytics</a>
          <a className="@nav-link" href="/settings">Settings</a>
        </nav>
      </aside>
      <div className="@stack-md flex-1">
        <header className="@row-between h-16 border-b border-border bg-card px-6">
          <h1 className="@heading-sm">Overview</h1>
          <div className="@row gap-4">
            <button className="@btn-icon"><span className="sr-only">Notifications</span></button>
            <div className="h-8 w-8 rounded-full bg-primary/20" />
          </div>
        </header>
        <main className="@wrapper @stack-lg py-8">
          <div className="@grid-3">
            <div className="@card-elevated">Card 1</div>
            <div className="@card-elevated">Card 2</div>
            <div className="@card-elevated">Card 3</div>
          </div>
          <div className="flex-1">{children}</div>
        </main>
      </div>
    </div>
  );
}`
};
