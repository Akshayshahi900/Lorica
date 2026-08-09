import Link from "next/link";
import {
  IconBrandGithub,
  IconChevronRight,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import { Shell } from "../../components/shell";
const repos = [
  {
    name: "checkout",
    owner: "acme",
    lang: "TypeScript",
    prs: 4,
    reviewed: "12 min ago",
    health: "Healthy",
  },
  {
    name: "api",
    owner: "acme",
    lang: "TypeScript",
    prs: 3,
    reviewed: "42 min ago",
    health: "Healthy",
  },
  {
    name: "web",
    owner: "acme",
    lang: "TypeScript",
    prs: 5,
    reviewed: "2h ago",
    health: "3 findings",
  },
  {
    name: "infra",
    owner: "acme",
    lang: "Terraform",
    prs: 0,
    reviewed: "4h ago",
    health: "Healthy",
  },
];
export default function Repositories() {
  return (
    <Shell
      title="Repositories"
      action={
        <Link href="/onboarding/github" className="button primary">
          <IconBrandGithub size={15} /> Connect GitHub
        </Link>
      }
    >
      <div className="page">
        <section className="page-intro">
          <div>
            <div className="eyebrow">SOURCE CONTROL</div>
            <h1>Your repositories</h1>
            <p>
              Connect GitHub repositories and let ReviewForge watch new pull
              requests.
            </p>
          </div>
        </section>
        <div className="connect-banner">
          <div className="connect-symbol">
            <IconBrandGithub size={22} />
          </div>
          <div>
            <strong>GitHub App connected</strong>
            <p>
              Reviews are automatically triggered when a pull request is opened
              or updated.
            </p>
          </div>
          <span className="connected">Connected</span>
        </div>
        <div className="filter-row">
          <div className="search compact">
            <IconSearch size={15} />
            <span>Filter repositories...</span>
          </div>
          <span className="muted">4 repositories</span>
        </div>
        <div className="repo-grid">
          {repos.map((r) => (
            <Link href="/reviews" className="repo-card" key={r.name}>
              <div className="repo-card-top">
                <div className="repo-icon large">{r.name[0].toUpperCase()}</div>
                <IconExternalLink size={15} />
              </div>
              <h3>
                {r.owner}/{r.name}
              </h3>
              <div className="repo-meta">
                <span>{r.lang}</span>
                <span>·</span>
                <span>{r.prs} open PRs</span>
              </div>
              <div className="repo-footer">
                <span
                  className={r.health === "Healthy" ? "healthy" : "attention"}
                >
                  {r.health}
                </span>
                <IconChevronRight size={15} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
