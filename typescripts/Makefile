.PHONY: restart # copy `.env.example` to .env and change `.env`
restart:
	pm2 delete gennia-bot 2> /dev/null || true && pm2 start pnpm --time --name "gennia-bot" -- start
