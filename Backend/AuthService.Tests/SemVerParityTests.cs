using System.Text.Json;
using AuthService.Application.Remotes;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The server's host-bridge compatibility check against the table the browser's check also runs.
/// </summary>
/// <remarks>
/// AuthService refuses to promote a remote the live host cannot run, and the host refuses to mount one.
/// If the two implementations disagreed, a remote could be promoted and then never load, or be refused
/// here while the browser would have run it fine. The table lives in
/// <c>Frontend/packages/host-bridge/src/__fixtures__/semver-parity.json</c>; add a row whenever either
/// side changes.
/// </remarks>
public class SemVerParityTests
{
    private sealed record ParityCase(string Version, string Range, bool Expected);

    private sealed record Fixture(List<ParityCase> Cases);

    private static readonly Lazy<Fixture> Table = new(() =>
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "Backend")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        var path = Path.Combine(dir!.FullName, "Frontend", "packages", "host-bridge", "src", "__fixtures__", "semver-parity.json");
        return JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    });

    public static TheoryData<int> CaseIndexes()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Table.Value.Cases.Count; i++) data.Add(i);
        return data;
    }

    [Theory]
    [MemberData(nameof(CaseIndexes))]
    public void The_server_answers_every_shared_case_as_the_table_expects(int index)
    {
        var testCase = Table.Value.Cases[index];

        Assert.True(
            SemVerRange.Satisfies(testCase.Version, testCase.Range) == testCase.Expected,
            $"\"{testCase.Version}\" against \"{testCase.Range}\": expected {testCase.Expected}.");
    }
}
