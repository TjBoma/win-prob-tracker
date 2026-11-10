# 🏀 NBA Win Probability Tracker

A full-stack web app that shows live NBA scores alongside each team's chance of winning, updated as the game goes on.

Before tip-off, the probability comes from how strong each team's record is. As the clock runs down, the real score takes over, so a strong team down 10 with two minutes left is (correctly) in big trouble.

---

## ✨ Features

- **Live scoreboard** for any date, with games refreshing automatically while in progress
- **Win probability** for every game: pregame, live, and final (100–0 to the winner)
- **Team strength ratings** built from this season's records, blended with last season's early on
- **Local tip-off times**, converted from the API's UTC timestamps
- **Preseason, regular season, and postseason** views

---

## 🛠️ Tech Stack

| Layer | Tools |
|---|---|
| **Frontend** | React, Vite |
| **Backend** | Node.js, Express |
| **Data** | [balldontlie API](https://www.balldontlie.io/) |

---

## 🧠 How the Model Works

The overall probability is built in three layers:

1. **Team strength:** each team's rating is based on its win-loss record.
2. **Pregame edge:** the two ratings are turned into a head-to-head probability using the **Log5 method**, with an extra edge for the home team.
3. **Live probability:** during a game, the model combines the current lead and time remaining with the pregame edge.

As the game goes on, the pregame edge fades in proportion to the time remaining, and the uncertainty shrinks as the clock winds down. Late leads eventually become nearly decisive.

---

## 📊 Testing

The model was backtested on the **2025–26 season**, comparing halftime predictions to final results. Games are replayed in date order, and each prediction only uses team records from **before** that game to avoid data leakage.

**Finding:** the model is overconfident at halftime. Teams given about an **85%** chance actually won about **77%** of the time.

<img width="1700" height="522" alt="Screenshot 2026-11-10 at 12 11 59 PM" src="https://github.com/user-attachments/assets/17b8f7a6-99a5-417a-b690-0fc4c9354bec" />

