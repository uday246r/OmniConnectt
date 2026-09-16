using System.Text.Json;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The server's field-format engine against the table the browser's engine is also held to.
/// </summary>
/// <remarks>
/// <para>
/// Every admin-configured format is checked twice: in the form, so a person sees the problem as they
/// type, and on the server, so a request that skips the form is held to the same rule. Two hand-written
/// engines in two languages drift, and they had: a Website URL of "mailto:…" passed in the browser and
/// failed here, "1,500" passed a numeric range here and failed there, a 9-digit Indian mobile number
/// passed here and failed there, and a text format with no mode chosen blocked everything here while
/// the browser let it through.
/// </para>
/// <para>
/// The table lives in <c>Frontend/packages/ui/src/validation/__fixtures__/rule-parity.json</c>, and
/// <c>ruleParity.test.ts</c> runs the same rows against the TypeScript engine. A disagreement fails a
/// build on whichever side changed.
/// </para>
/// </remarks>
public class ValidationParityTests
{
    private sealed record FixturePreset(
        string Key, string Label, string Kind, string? Pattern, int? MinLength, int? MaxLength,
        decimal? MinValue, decimal? MaxValue, string Message, string? TextMode);

    private sealed record FixtureRule(string Type, string? Pattern, int? Value);

    private sealed record FixtureCase(FixtureRule Rule, string Value, bool Valid, string? Note);

    private sealed record Fixture(List<FixturePreset> Presets, List<FixtureCase> Cases);

    private static readonly Lazy<Fixture> Table = new(() =>
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "Backend")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        var path = Path.Combine(dir!.FullName, "Frontend", "packages", "ui", "src", "validation", "__fixtures__", "rule-parity.json");
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
    public void The_server_engine_gives_every_shared_case_the_expected_answer(int index)
    {
        var fixture = Table.Value;
        var testCase = fixture.Cases[index];
        var presets = FieldRuleEngine.Index(fixture.Presets.Select(p =>
            new FormatPreset(p.Key, p.Label, p.Kind, p.Pattern, p.MinLength, p.MaxLength, p.MinValue, p.MaxValue, p.Message, p.TextMode)));
        var rule = new FieldRule(testCase.Rule.Type, testCase.Rule.Pattern, testCase.Rule.Value, "failed");

        var failure = FieldRuleEngine.FirstFailure([rule], testCase.Value, presets);

        Assert.True(
            (failure is null) == testCase.Valid,
            $"{testCase.Rule.Type} on \"{testCase.Value}\": expected {(testCase.Valid ? "valid" : "invalid")}. {testCase.Note}");
    }

    [Fact]
    public void Every_built_in_preset_is_covered_by_the_shared_table()
    {
        var covered = Table.Value.Cases.Select(c => c.Rule.Type).ToHashSet();

        Assert.DoesNotContain(FieldPresets.BuiltInIds, id => !covered.Contains(id));
    }
}
