# Plain-Language Glossary

| Word | Plain meaning |
| --- | --- |
| AI assistant | A tool that can read instructions and help prepare a change. It still needs review and approval. |
| GitHub | The service that stores the website's source and change history. |
| Repository | The MPRC website project stored in GitHub. |
| Issue | A tracked request describing one problem or result. |
| Branch | A separate working copy used to prepare one change safely. |
| Commit | A named snapshot of source changes. It helps identify exactly which version was built. |
| Pull request | A review page showing a proposed change before it joins the main version. |
| Review | A person or review agent checks the change for mistakes and risk. |
| Merge | GitHub accepts an approved pull request into `main`. This does not always mean the change is live. |
| Publish or deploy | A service receives a new version. Each service must be checked separately. |
| Production or live | The version real visitors or officers actually use. |
| Frontend | The pages people see in a browser. |
| Backend | Private services behind the pages, including login, data, and server actions. |
| Firebase | The service used for login, database records, and backend Functions. |
| Firestore | The database inside Firebase. Saving an Admin form can change its records immediately. |
| Function | A protected backend action, such as checking access or handling a payment event. |
| Netlify | The service currently answering requests for `runmprc.com`. |
| GitHub Pages | A second website copy built from GitHub. It is not currently the custom-domain production copy. |
| Stripe | The outside payment service. MPRC live commerce is not approved yet. |
| Secret | A password-like value, key, token, or recovery code that must not be put in source, issues, AI, email, or screenshots. |
| Token | A password-like value that lets a person or service act. Treat it as a secret. |
| Service account | A non-human account used by automation. Its key is a secret and must have limited access. |
| Two-factor authentication (2FA) | A second sign-in check, preferably a passkey, authenticator, or hardware key rather than a text message. |
| Least privilege | Giving a person or service only the access needed for its job. |
| Staging | A separate safe environment used to test before production. MPRC does not yet have a proven isolated staging environment. |
| Index | A database helper that makes an approved query work. It is not the website home page. |
| Test mode | A safe provider mode that uses fake payments and test data. |
| Rollback or revert | A reviewed change that restores the last known-good version. |
| DNS | The settings that direct `runmprc.com` to a website host. DNS changes can take the whole site offline. |
| CI or workflow | Automated checks and build jobs in GitHub. Green means those jobs passed, not necessarily that production changed. |
