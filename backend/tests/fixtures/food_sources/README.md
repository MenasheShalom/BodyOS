# Food source fixtures

Responses from Open Food Facts (OFF) and USDA FoodData Central (FDC) used by the normaliser,
client and API tests. CI never calls the network.

The first set was **hand-built from the documented response formats** because the build
environment could not reach either API. Re-record them from the live APIs with:

```bash
cd backend && USDA_API_KEY=<key> python scripts/record_food_fixtures.py
```

then re-run `pytest tests/test_food_normalise.py` and fix any field the live data disagrees on.
