FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# Threads statt eventlet: Flask-SocketIO im "threading"-Modus (WebSocket über simple-websocket),
# so läuft auch die digitale Tafel (tafel/) so, wie sie getestet wurde.
ENV ASYNC_MODE=threading
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
# Wichtig: genau ein Worker (Räume, Online-Status und der Tafelzustand liegen im Arbeitsspeicher)
CMD ["gunicorn", "-w", "1", "--worker-class", "gthread", "--threads", "100", "-b", "0.0.0.0:5000", "app:app"]
