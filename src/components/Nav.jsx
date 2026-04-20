export default function Nav({ customerName, projectName, onBack, onSettings, onLogout }) {
  return (
    <nav className="nav">
      <div className="nav-left">
        {onBack && (
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            &larr; Back
          </button>
        )}
        <div className="nav-brand">
          <img src="/leadhunt-logo.png" alt="LeadHunt" />
        </div>
        {customerName && (
          <>
            <span className="nav-sep">/</span>
            <span className="nav-title">{customerName}</span>
          </>
        )}
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
