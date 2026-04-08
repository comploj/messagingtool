export default function Nav({ projectName, onBack, onSettings, onLogout }) {
  return (
    <nav className="nav">
      <div className="nav-left">
        {onBack && (
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            &larr; Back
          </button>
        )}
        <span className="nav-brand">LeadHunt</span>
        {projectName && (
          <>
            <span className="nav-sep">/</span>
            <span className="nav-title">{projectName}</span>
          </>
        )}
      </div>
      <div className="nav-right">
        <button className="btn btn-ghost btn-sm" onClick={onSettings}>
          Settings
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>
          Logout
        </button>
      </div>
    </nav>
  );
}
