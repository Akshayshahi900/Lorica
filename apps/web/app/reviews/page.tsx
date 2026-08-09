import Link from "next/link";
import { IconFilter, IconSearch, IconSparkles } from "@tabler/icons-react";
import { Shell } from "../../components/shell";
import { Status } from "../../components/status";
import { reviews } from "../../lib/data";
export default function Reviews() {
  return (
    <Shell title="PRs & Reviews">
      <div className="page">
        <section className="page-intro">
          <div>
            <div className="eyebrow">CODE REVIEW QUEUE</div>
            <h1>Pull requests</h1>
            <p>
              Review AI findings, inspect diffs, and resolve actionable
              feedback.
            </p>
          </div>
        </section>
        <div className="review-toolbar">
          <div className="search compact">
            <IconSearch size={15} />
            <span>Search pull requests...</span>
          </div>
          <button className="button ghost">
            <IconFilter size={15} /> All statuses
          </button>
        </div>
        <div className="review-list">
          {reviews.map((r) => (
            <Link href={`/reviews/${r.id}`} className="review-card" key={r.id}>
              <div className="review-card-main">
                <div className="repo-icon">
                  {r.repo.split("/")[1][0].toUpperCase()}
                </div>
                <div>
                  <div className="review-title">
                    <h3>{r.title}</h3>
                    <span className="mono">{r.pr}</span>
                  </div>
                  <div className="review-sub">
                    {r.repo} <span>·</span> {r.branch} <span>·</span> updated{" "}
                    {r.time}
                  </div>
                  <div className="review-chips">
                    <span>
                      <IconSparkles size={13} /> AI score {r.score}
                    </span>
                    <span>{r.files} files changed</span>
                    <span className="add">+{r.additions}</span>
                    <span className="del">−{r.deletions}</span>
                  </div>
                </div>
              </div>
              <div className="review-card-side">
                <Status type={r.status === "Approved" ? "success" : "warning"}>
                  {r.status}
                </Status>
                <span className="issue-count">
                  {r.issues} {r.issues === 1 ? "issue" : "issues"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
