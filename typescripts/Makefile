.PHONY: restart # copy `.env.example` to .env and change `.env`
restart:
	pm2 delete gennia-bot 2> /dev/null || true && pm2 start pnpm --time --name "gennia-bot" -- start --server_url=https://api.gennia.cn --bot_name=GenniaBot1 --room_id=1
	pm2 delete gennia-bot2 2> /dev/null || true && pm2 start pnpm --time --name "gennia-bot2" -- start --server_url=https://api.gennia.cn --bot_name=GenniaBot2 --room_id=warring_state
