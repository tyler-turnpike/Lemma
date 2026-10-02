from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather-demo")


@mcp.tool()
def get_forecast(city: str) -> str:
    return f"Forecast for {city}: sunny"
