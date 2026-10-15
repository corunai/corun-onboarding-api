FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV CACHE_PATH=/data/cache.sqlite3
# Render (and other hosts) inject PORT. Default matches local `docker run -p 8000:8000`.
ENV PORT=8000
VOLUME /data
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
