# Repo Watcher

Well it's quite simple in my opinion:
- You give it OWNER/REPO for a public github repo
- A Github Personal Access Token (PAT) is optional: without one you get GitHub's unauthenticated 60 req/hr limit, with one up to 5,000/hr
- It gives you info

## Getting a PAT (optional)
1. Go to [here](https://github.com/settings/personal-access-tokens) 
2. Generate Fine grained one configure and copy api key
3. Put in the settings and voila you went from using 60/hr to 5000/hr api request limits
4. Or leave the token box empty and click Save/Go to use the app without a key (60/hr)

## Features
So it tells you info, but what is that info:
- You have the percentage of the project for each lang
- Percentage for each commit too
- Commit list
- Actions status
- Auto Refresh
- Commit description
and some other things which I can't think of right now

# CREDITS
- Inter Font - Google Fonts
- Settings Icon - Hackclub Icons (Superset of) - spectrum-icons

# Tools Used
- Claude
- VsCode (code-server)
- Live Server (VsCode Extension)

# AI Declaration
- Used for making [PLAN.md](PLAN.md)
- Color scheme brainstorming ([theme.css](/theme.css))