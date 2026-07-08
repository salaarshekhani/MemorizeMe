<a name="top"></a>
[![Made for Hack Club Horizons](https://img.shields.io/badge/made%20for-%23Horizons-ec3750?logo=hackclub&logoColor=white)](https://horizons.hackclub.com/)
[![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Status](https://img.shields.io/badge/status-active_development-brightgreen)](#roadmap)

# MemorizeMe

## Table of Contents
- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Running It Locally](#running-it-locally)
- [Roadmap](#roadmap)
- [Contact](#contact)

## About

MemoriseMe is a flashcard and quiz app for memorizing anything: vocabulary, definitions, formulas, whatever you're trying to jam into your head. Flip through cards, quiz yourself against a timer, or grind through just the ones you keep getting wrong. It tracks XP, levels, and streaks so studying feels less like a chore and more like a game you're slowly winning.

Built for [Hack Club Horizons](https://horizons.hackclub.com/), a summer coding marathon for high schoolers.:D

## Features
- Flip through flashcards at your own pace
- Timed Quiz Mode, type the answer before the clock runs out
- Untimed Practice Mode for when you just want to review
- Weak Cards mode that only pulls up the ones you've missed before
- XP, levels, and streaks that update as you study
- Works without an account, everything just saves in your browser
- Create an account and your cards and progress follow you to any device
- Light and dark theme
- Add, delete, import, and export your flashcards as JSON

## Tech Stack

- **Backend**: Python, Flask, SQLite
- **Frontend**: plain HTML, CSS, and JavaScript
- **Auth**: Flask sessions with salted password hashing

## How It Works

The frontend is just static pages that call a small Flask API. If you're not logged in, everything (your cards, settings, XP, streaks) lives in your browser's `localStorage`, so you can use the whole app without ever making an account. Create one and that same data gets stored on the server instead, so it's there no matter what device you log in from.

Every quiz session gets scored, saved, and turned into XP. Get something wrong enough times and it starts showing up in Weak Cards until you actually learn it.

## Running It Locally

```shell
git clone https://github.com/<your-username>/MemoriseMe.git
cd MemoriseMe
pip install -r backend/requirements.txt
python backend/app.py
```

Then open `http://localhost:5000`. The database sets itself up on first run, nothing else to configure.

## Roadmap

- [ ] Multiple choice as an option alongside typed answers
- [ ] Group flashcards into separate decks by subject
- [ ] Charts for XP and accuracy over time
- [ ] Spaced repetition so cards resurface right before you'd forget them

## Contact

Made by Salaar Adnan Shekhani for Hack Club Horizons. Open an issue or reach out directly at @salaar.adnanshekhani on Slack with questions, bugs, or ideas.

[Back to top](#top)
