# CashFlowOS house rules

Every Claude session on this repo follows these. Mama Lek is one outlet, and this app holds real money data.

## Who owns what

| Area | Owner | GitHub |
| --- | --- | --- |
| Finance | Eric | mamalekmy-dotcom |
| HR | Aw Su Ni | suniawxv83-cell |
| Marketing | Teo Wee Chian | Calixto95 |
| CRM | Lee Zhi Xiang | davidlee6123 |
| Suppliers | Eddy Lau Yik Tian | oneday96 |

Change another owner's area only after they agree.

## Decisions not to reverse silently

- Monthly P&L comes from TMS OS. Purchases and stock come from Stock 2026. POS reports are for daily figures only.
- Never submit or change data in TMS OS.
- Staff use personal logins. The admin creates them, and sign-ups stay off. Disable accounts, never delete them.
- Only active owners can Approve, Reject or `/undo`.
- In a group the bot speaks only when spoken to. Do not set `GROUP_REPLY_TO_ALL=true` unless Eric asks.
- Groups must be listed in `TELEGRAM_TEAM_CHAT_IDS`, otherwise the bot stays silent there.
- The morning brief goes to Eric's DM unless Eric sets `briefChatIds`.
- Built-in red lines stay on: the bot never messages a customer, never moves money, never deletes.

## Secrets

- Never print, echo, commit or paste `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_PASSCODE` or any POS key. Eric types these himself.
- Never commit `.env`.

## Database

- Never blanket-delete rows in `records`. Delete by explicit id or exact title only, back up first, and say where the backup is.
- Never approve, reject or undo a pending proposal while testing. Some are real money.
- Stop and ask before anything destructive or irreversible.

## Vercel

- Never add a second cron. Hobby allows two, and spending a slot is Eric's decision.
- Env changes need a redeploy.

## Before you push

```bash
git fetch && git log --oneline main..origin/main
```

Rebase onto anything new. Never force-push. Never touch a branch you didn't create.
