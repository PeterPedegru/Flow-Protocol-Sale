# FLOW Auction CLI Bot

CLI-бот для:
- мониторинга on-chain бидов (`BidSubmitted`) в аукционе Flow;
- ручной отправки своего бида через `Flow build-tx -> Bankr /agent/submit`.

## Установка

```bash
npm install
cp .env.example .env
```

Заполни `.env`:
- `BANKR_API_KEY`
- `BASE_RPC_URL`

## Запуск

```bash
npm run bot
```

## Команды

- `help`
- `status`
- `bid <USDC> <maxFDV_USD>`
- `quit`

## Логи мониторинга

Формат строки:

```text
time block tx bidder bidId amountUSDC maxFDV phase
```

`phase`: `before_start | pre_bid | clearing | ended`.

## Тесты

```bash
npm test
```
