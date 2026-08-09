import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrandGithub,
  IconCheck,
  IconLock,
  IconSparkles,
} from "@tabler/icons-react";
export default function GithubOnboarding() {
  return (
    <main className="onboarding">
      <div className="onboarding-nav">
        <Link href="/" className="brand">
          <div className="brand-mark">
            <span>⌘</span>
          </div>
          <span>reviewforge</span>
          <span className="brand-badge">AI</span>
        </Link>
        <span className="muted">GitHub integration</span>
      </div>
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <IconBrandGithub size={30} />
        </div>
        <div className="eyebrow">STEP 1 OF 1</div>
        <h1>Connect your GitHub</h1>
        <p>
          Give ReviewForge access to your repositories. We’ll listen for pull
          request changes and automatically prepare AI feedback.
        </p>
        <div className="permission-list">
          <div>
            <IconCheck size={15} />
            <span>Read pull requests and changed files</span>
          </div>
          <div>
            <IconCheck size={15} />
            <span>Post review comments on your behalf</span>
          </div>
          <div>
            <IconLock size={15} />
            <span>No access to repository secrets</span>
          </div>
        </div>
        <button className="github-button">
          <IconBrandGithub size={18} /> Install GitHub App{" "}
          <IconArrowRight size={16} />
        </button>
        <div className="onboarding-foot">
          <IconSparkles size={14} /> You can choose exactly which repositories
          to enable.
        </div>
      </div>
      <Link href="/" className="back">
        <IconArrowLeft size={14} /> Back to dashboard
      </Link>
    </main>
  );
}
