using MyVideoGameList.Server.Errors;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A request path arrives decoded, so anything a caller can put in a URL can reach a log line.
/// </summary>
public class LogTextTests
{
    [Fact]
    public void OneLine_WithALineBreak_KeepsItToOneLine()
    {
        // What a request to /api/games/%0AINFO:+all+clear looks like by the time it is a value:
        // a second line in the log that nothing distinguishes from one the app wrote.
        var forged = LogText.OneLine("/api/games/\nINFO: all clear");

        Assert.Equal("/api/games/INFO: all clear", forged);
    }

    [Theory]
    [InlineData("/api/games/\r\n1")]
    [InlineData("/api/games/\t1")]
    public void OneLine_WithAnyControlCharacter_DropsIt(string path)
    {
        Assert.Equal("/api/games/1", LogText.OneLine(path));
    }

    /// <summary>
    /// The two that cannot be written as escapes here. A NUL escape in this file became a real NUL
    /// byte once already, which compiles but makes git call the source binary and stop diffing it;
    /// and U+2028 is a line separator that <c>char.IsControl</c> does not count, so it needs
    /// covering and is invisible on the page. Both are built from their code points instead.
    /// </summary>
    [Theory]
    [InlineData(0x0000)]
    [InlineData(0x2028)]
    public void OneLine_WithACharacterFromItsCodePoint_DropsIt(int codePoint)
    {
        var path = $"/api/games/{(char)codePoint}1";

        Assert.Equal("/api/games/1", LogText.OneLine(path));
    }

    [Fact]
    public void OneLine_WithAnOrdinaryPath_LeavesItAlone()
    {
        Assert.Equal("/api/games/1020", LogText.OneLine("/api/games/1020"));
    }

    [Fact]
    public void OneLine_WithAVeryLongPath_TruncatesIt()
    {
        var truncated = LogText.OneLine(new string('x', 500));

        // Long enough for any real path, short enough that one crafted request cannot bury the
        // lines around it.
        Assert.Equal(203, truncated.Length);
        Assert.EndsWith("...", truncated);
    }

    [Fact]
    public void OneLine_WithNothing_IsEmpty()
    {
        Assert.Equal(string.Empty, LogText.OneLine(null));
    }
}
