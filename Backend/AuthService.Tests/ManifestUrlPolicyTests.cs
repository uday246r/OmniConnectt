using AuthService.Application.Exceptions;
using AuthService.Application.Remotes;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// What a remote app's manifest URL may be.
/// </summary>
/// <remarks>
/// The URL decides which code runs inside the host for that app's users, and AuthService fetches it from
/// inside the private network. So the rule has to hold three lines: an app is served only from its own
/// folder, a production registration cannot name an outside address, and a relative path cannot slip
/// through the "is it absolute?" check as a file:// URI — which on Linux it otherwise does.
/// </remarks>
public class ManifestUrlPolicyTests
{
    [Fact]
    public void A_versioned_path_under_the_apps_own_folder_is_accepted()
    {
        Assert.Equal("/modules/lead/4.7.3/mf-manifest.json",
            ManifestUrlPolicy.Normalize("  /modules/lead/4.7.3/mf-manifest.json ", "lead", allowAbsolute: false));
    }

    [Fact]
    public void A_path_under_another_apps_folder_is_refused()
    {
        var error = Assert.Throws<ValidationAppException>(() =>
            ManifestUrlPolicy.Normalize("/modules/customer360/2.0.0/mf-manifest.json", "lead", allowAbsolute: true));

        Assert.Contains("/modules/lead/", error.Message);
    }

    [Theory]
    [InlineData("/modules/lead/mf-manifest.json")]
    [InlineData("/modules/lead/../customer360/1.0.0/mf-manifest.json")]
    [InlineData("/modules/lead/1.0.0/remoteEntry.js")]
    [InlineData("/assets/mf-manifest.json")]
    public void A_path_that_is_not_one_versioned_manifest_is_refused(string url)
    {
        Assert.Throws<ValidationAppException>(() => ManifestUrlPolicy.Normalize(url, "lead", allowAbsolute: true));
    }

    [Fact]
    public void An_absolute_url_is_refused_where_absolute_urls_are_not_allowed()
    {
        var error = Assert.Throws<ValidationAppException>(() =>
            ManifestUrlPolicy.Normalize("http://169.254.169.254/mf-manifest.json", "lead", allowAbsolute: false));

        Assert.Contains("development", error.Message);
    }

    [Fact]
    public void An_absolute_http_url_is_accepted_in_development()
    {
        Assert.Equal("http://127.0.0.1:5002/mf-manifest.json",
            ManifestUrlPolicy.Normalize("http://127.0.0.1:5002/mf-manifest.json", "lead", allowAbsolute: true));
    }

    [Theory]
    [InlineData("file:///etc/passwd")]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://example.com/mf-manifest.json")]
    public void A_non_http_scheme_is_refused_even_where_absolute_urls_are_allowed(string url)
    {
        Assert.Throws<ValidationAppException>(() => ManifestUrlPolicy.Normalize(url, "lead", allowAbsolute: true));
    }

    [Fact]
    public void The_version_is_read_back_from_a_relative_url_and_absent_from_an_absolute_one()
    {
        Assert.Equal("4.7.3", ManifestUrlPolicy.VersionOf("/modules/lead/4.7.3/mf-manifest.json"));
        Assert.Null(ManifestUrlPolicy.VersionOf("http://127.0.0.1:5002/mf-manifest.json"));
    }
}
