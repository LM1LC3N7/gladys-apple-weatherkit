# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
follows the public documentation of the Apple WeatherKit REST API and was
written with the help of the project below, distributed under its own license.

## python-weatherkit (TJ Horner)

<https://github.com/tjhorner/python-weatherkit>, the Python client used by the
Apple WeatherKit integration of Home Assistant (PyPI `apple-weatherkit`,
version 1.2.0, last commit 5d07c2a, 2026-04-04).

Followed in `src/jwt.js` and `src/weatherkit.js`: the shape of the token
(ES256, header `kid` and `id` = team.service, claims `iss`, `iat`, `exp`,
`sub`), the data sets asked and the `hourlyStart`/`hourlyEnd`/`countryCode`
parameters of `/api/v1/weather/{language}/{latitude}/{longitude}`, the
`/api/v1/availability` endpoint, and the observation that WeatherKit can
answer 401/403 once without the credentials being wrong (the client retries
them). No code copied: written anew in JavaScript with node:crypto.

```
MIT License

Copyright (c) 2023 TJ Horner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
