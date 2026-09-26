"""Entrypoint for `uvicorn main:app`. The application lives in the infraalert package."""

from dotenv import load_dotenv

from infraalert.app import create_app

load_dotenv()
app = create_app()
