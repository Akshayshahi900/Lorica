export const reviews = [
  { id:"review-184", repo:"acme/checkout", pr:"#184", title:"refactor payment retry flow", author:"AK", status:"Needs attention", issues:4, files:7, additions:128, deletions:44, time:"8m ago", branch:"feat/payment-retries", score:72 },
  { id:"review-181", repo:"acme/api", pr:"#181", title:"add idempotency keys", author:"RS", status:"Approved", issues:0, files:3, additions:61, deletions:12, time:"42m ago", branch:"feat/idempotency", score:96 },
  { id:"review-177", repo:"acme/web", pr:"#177", title:"replace legacy auth hook", author:"MP", status:"Needs attention", issues:2, files:11, additions:210, deletions:187, time:"2h ago", branch:"refactor/auth-hook", score:81 },
  { id:"review-174", repo:"acme/infra", pr:"#174", title:"bump postgres image", author:"JD", status:"Approved", issues:0, files:1, additions:2, deletions:2, time:"4h ago", branch:"chore/postgres", score:100 }
];

export const findings = [
  { id:"F-01", severity:"warning", file:"src/services/payment-retry.ts", line:42, title:"Retry can duplicate a charge", body:"The retry path calls chargeCustomer before checking whether the previous attempt reached the provider. A timeout can therefore produce two charges for the same order.", suggestion:"Persist the provider request id before the call and use it as the idempotency key on every retry." },
  { id:"F-02", severity:"error", file:"src/services/payment-retry.ts", line:67, title:"Error state is swallowed", body:"The catch block logs the provider error but returns a successful result. Callers will mark the order as paid even when all retry attempts fail.", suggestion:"Re-throw a typed PaymentRetryError after the final attempt and keep the order transition atomic." },
  { id:"F-03", severity:"info", file:"src/lib/backoff.ts", line:19, title:"Backoff cap is missing", body:"Exponential delay grows without a maximum. A long-lived worker can sleep for several minutes after transient failures.", suggestion:"Clamp the delay to a bounded maximum, for example 30 seconds, and add jitter." }
];
