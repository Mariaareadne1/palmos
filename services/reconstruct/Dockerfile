# palmós reconstruction service.
#
# Runs on the core dependencies only (SPEC §0 rule 2). Optional SAM /
# tesseract / anthropic enhancements are NOT baked in — add them to a
# derived image if you need them.
FROM python:3.11-slim

# opencv-python-headless still needs libGL and glib at runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# Default to a single worker: the default job store is in-memory and not
# shared across workers. To scale out, set REDIS_URL (activates the Redis
# job store) and raise the worker count, e.g.
#   CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--workers","4"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
