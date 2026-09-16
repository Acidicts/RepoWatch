# Repo Watcher

Well it's quite simple in my opinion:
- You give it OWNER/REPO for a public github repo
- It needs a Github Personal Access Token (PAT) to increase rate-limit and won't run without one due to doing api key checks on change to it
- It gives you info

## Getting a PAT
1. Go to [here](https://github.com/settings/personal-access-tokens) 
2. Generate Fine grained one configure and copy api key
3. Put in the settings and voila you went from using 100/hr to 5000/hr api request limits

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