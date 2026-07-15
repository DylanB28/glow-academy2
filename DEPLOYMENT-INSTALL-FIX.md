# Vercel dependency-install fix

This revision removes private/internal registry URLs from `package-lock.json`, pins Node.js 22, and tells Vercel to install production dependencies only.

After replacing these files in GitHub, redeploy in Vercel with **Clear build cache** enabled.
