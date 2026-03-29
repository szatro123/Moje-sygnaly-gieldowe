import telebot
import yfinance as yf
from textblob import TextBlob
import time

TOKEN = "TWÓJ_TOKEN"   # zostanie nadpisany na Renderze

bot = telebot.TeleBot(TOKEN)

WATCHLIST = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOGL", "PKN.WA", "KGHM.WA", "CDR.WA"]

def get_price(ticker):
    try:
        info = yf.Ticker(ticker).info
        price = info.get('currentPrice') or info.get('regularMarketPrice')
        return round(price, 2) if price else "—"
    except:
        return "Błąd"

def get_positive_news(ticker):
    try:
        news = yf.Ticker(ticker).news[:6]
        good = []
        for item in news:
            title = item.get('title', '')
            if TextBlob(title).sentiment.polarity > 0.2:
                price = get_price(ticker)
                good.append(f"🚀 **{ticker}** \~{price}\n{title[:130]}...")
        return good
    except:
        return []

@bot.message_handler(commands=['start'])
def start(message):
    bot.reply_to(message, "✅ Bot działa!\n\nKomendy:\n/scan - sprawdź wszystkie\n/price TICKER - cena\n/news TICKER - dobre newsy")

@bot.message_handler(commands=['price'])
def price_cmd(message):
    try:
        ticker = message.text.split()[1].upper()
        price = get_price(ticker)
        bot.reply_to(message, f"💰 **{ticker}**: {price}")
    except:
        bot.reply_to(message, "Przykład: /price AAPL")

@bot.message_handler(commands=['news'])
def news_cmd(message):
    try:
        ticker = message.text.split()[1].upper()
        news_list = get_positive_news(ticker)
        if news_list:
            bot.reply_to(message, "\n\n".join(news_list), parse_mode='Markdown')
        else:
            bot.reply_to(message, f"Brak mocno pozytywnych newsów dla {ticker}")
    except:
        bot.reply_to(message, "Przykład: /news AAPL")

@bot.message_handler(commands=['scan'])
def scan_cmd(message):
    bot.reply_to(message, "🔍 Skanuję akcje...")
    for ticker in WATCHLIST:
        price = get_price(ticker)
        news_list = get_positive_news(ticker)
        msg = f"**{ticker}** → Cena: {price}"
        if news_list:
            msg += "\n\n✅ Dobre newsy:\n" + "\n".join(news_list)
        bot.send_message(message.chat.id, msg, parse_mode='Markdown')
        time.sleep(1)

print("Bot uruchomiony...")
bot.infinity_polling()
