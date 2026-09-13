# Exchange 🚀

A mobile-first social promotion marketplace MVP.

## Current scope
- Responsive dashboard
- Credit wallet UI
- Community task feed
- Platform filtering
- Profile management UI
- Basic analytics UI
- Express API with security headers and rate limiting
- Vercel deployment configuration
- Supabase environment placeholders

## Safety boundary
Exchange does not create fake social accounts, automate follows/subscriptions, bypass platform security, or inflate metrics through bots. Tasks are designed around user actions on the official social platform.

## Local development
```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Supabase
The application is prepared for Supabase integration through environment variables. Database schema, authentication, RLS policies, and production secrets should be configured in the owner's Supabase project.

## Deployment
Import the GitHub repository into Vercel and add the required environment variables in the Vercel project settings.
