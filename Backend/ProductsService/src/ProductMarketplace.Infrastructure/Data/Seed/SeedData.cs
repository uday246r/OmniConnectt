using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductMarketplace.Infrastructure.Data.Seed;

public static class SeedData
{
    private static readonly string[] FirstNames = { "Aarav", "Vivaan", "Aditi", "Ishaan", "Priya", "Rohan", "Ananya", "Kabir", "Meera", "Sanya", "Arjun", "Divya", "Karan", "Neha", "Rahul", "Simran" };
    private static readonly string[] LastNames = { "Sharma", "Verma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Malhotra", "Kapoor", "Chatterjee", "Bose", "Rao" };

    public static async Task SeedAsync(AppDbContext db)
    {
        var now = DateTime.UtcNow;

        if (!await db.Categories.AnyAsync())
        {
            // ---------------- Categories ----------------
            Category Cat(string name, string slug, string desc, string icon, int order) => new()
            {
                Name = name, Slug = slug, Description = desc, IconKey = icon, DisplayOrder = order,
                Status = "Active", CreatedAt = now.AddDays(-order), UpdatedAt = now
            };

        var catLoans = Cat("Loans", "loans", "Various types of loans for personal and business needs", "loans", 1);
        var catCards = Cat("Credit Cards", "credit-cards", "Credit card products with exciting rewards and offers", "credit-card", 2);
        var catAccounts = Cat("Accounts", "accounts", "Savings, current and salary accounts", "accounts", 3);
        var catInvestments = Cat("Investments", "investments", "Invest in mutual funds, bonds and more", "investments", 4);
        var catInsurance = Cat("Insurance", "insurance", "Life, health, motor and other insurance plans", "insurance", 5);
        var catDeposits = Cat("Deposits", "deposits", "Fixed deposits, recurring deposits and other deposit schemes", "deposits", 6);

        db.Categories.AddRange(catLoans, catCards, catAccounts, catInvestments, catInsurance, catDeposits);

        // Sub-categories (real, minimal - loans has two illustrative sub-categories)
        var subSecured = new Category { Name = "Secured Loans", Slug = "secured-loans", Description = "Loans backed by collateral", IconKey = "shield", DisplayOrder = 1, ParentCategoryId = catLoans.Id, Status = "Active", CreatedAt = now, UpdatedAt = now };
        var subUnsecured = new Category { Name = "Unsecured Loans", Slug = "unsecured-loans", Description = "Loans without collateral", IconKey = "package", DisplayOrder = 2, ParentCategoryId = catLoans.Id, Status = "Active", CreatedAt = now, UpdatedAt = now };
        db.Categories.AddRange(subSecured, subUnsecured);

        // ---------------- Product Types + Field Definitions ----------------
        FieldDefinition Field(string key, string label, FieldDataType type, string unit, bool required, bool filterable,
            bool sortable, bool card, bool details, bool application, bool primary, bool secondary, int order) => new()
        {
            Key = key, Label = label, DataType = type, Unit = unit, Required = required, Filterable = filterable,
            VisibleToCustomer = true, Sortable = sortable, DisplayOnCard = card, DisplayOnDetails = details,
            DisplayInApplication = application, IsPrimaryMetric = primary, IsSecondaryMetric = secondary, SortOrder = order
        };

        var ptLoan = new ProductType
        {
            Name = "Loan", Code = "loan", IconKey = "loan",
            ApplyButtonLabel = "Apply Now", AmountFieldLabel = "Requested Amount", ShortLabel = "Loan",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("interest_rate", "Interest Rate", FieldDataType.Percentage, " onwards", true, true, true, true, true, false, true, false, 1),
                Field("loan_amount", "Loan Amount", FieldDataType.Text, "", true, true, false, true, true, true, false, true, 2),
                Field("tenure", "Tenure", FieldDataType.Text, "", true, false, false, false, true, true, false, false, 3),
                Field("processing_fee", "Processing Fee", FieldDataType.Percentage, " of loan amount", false, false, false, false, true, true, false, false, 4),
                Field("min_income", "Minimum Monthly Income", FieldDataType.Currency, "/month", false, false, false, false, true, true, false, false, 5),
            }
        };
        var ptCard = new ProductType
        {
            Name = "Credit Card", Code = "credit-card", IconKey = "credit-card",
            ApplyButtonLabel = "Apply Now", AmountFieldLabel = "Credit Limit", ShortLabel = "Card",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("joining_fee", "Joining Fee", FieldDataType.Currency, "", true, true, true, true, true, false, true, false, 1),
                Field("annual_fee", "Annual Fee", FieldDataType.Currency, "", true, true, false, true, true, false, false, true, 2),
                Field("credit_limit", "Credit Limit", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 3),
                Field("cashback", "Cashback", FieldDataType.Percentage, " on all spends", false, false, false, false, true, false, false, false, 4),
                Field("reward_rate", "Reward Points", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 5),
            }
        };
        var ptFd = new ProductType
        {
            Name = "Fixed Deposit", Code = "fixed-deposit", IconKey = "deposit",
            ApplyButtonLabel = "Open Deposit", AmountFieldLabel = "Deposit Amount", ShortLabel = "Deposit",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("interest_rate", "Interest Rate", FieldDataType.Percentage, " p.a.", true, true, true, true, true, false, true, false, 1),
                Field("min_deposit", "Minimum Deposit", FieldDataType.Currency, " onwards", true, true, false, true, true, true, false, true, 2),
                Field("tenure", "Tenure", FieldDataType.Text, "", true, false, false, false, true, true, false, false, 3),
                Field("maturity_benefit", "Maturity Benefit", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 4),
            }
        };
        var ptRd = new ProductType
        {
            Name = "Recurring Deposit", Code = "recurring-deposit", IconKey = "deposit",
            ApplyButtonLabel = "Open Deposit", AmountFieldLabel = "Monthly Deposit Amount", ShortLabel = "Deposit",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("interest_rate", "Interest Rate", FieldDataType.Percentage, " p.a.", true, true, true, true, true, false, true, false, 1),
                Field("min_monthly_deposit", "Minimum Monthly Deposit", FieldDataType.Currency, "/month", true, true, false, true, true, true, false, true, 2),
                Field("tenure", "Tenure", FieldDataType.Text, "", true, false, false, false, true, true, false, false, 3),
            }
        };
        var ptSavings = new ProductType
        {
            Name = "Savings Account", Code = "savings-account", IconKey = "accounts",
            ApplyButtonLabel = "Open Account", AmountFieldLabel = "Initial Funding Amount", ShortLabel = "Account",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("interest_rate", "Interest Rate", FieldDataType.Percentage, " p.a.", true, true, true, true, true, false, true, false, 1),
                Field("min_balance", "Minimum Balance", FieldDataType.Currency, "", true, true, false, true, true, false, false, true, 2),
                Field("account_type", "Account Type", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 3),
            }
        };
        var ptCurrent = new ProductType
        {
            Name = "Current Account", Code = "current-account", IconKey = "accounts",
            ApplyButtonLabel = "Open Account", AmountFieldLabel = "Initial Funding Amount", ShortLabel = "Account",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("min_balance", "Minimum Balance", FieldDataType.Currency, "", true, true, true, true, true, false, true, false, 1),
                Field("monthly_transactions", "Free Monthly Transactions", FieldDataType.Text, "", false, false, false, true, true, false, false, true, 2),
                Field("features", "Key Features", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 3),
            }
        };
        var ptInsurance = new ProductType
        {
            Name = "Insurance", Code = "insurance", IconKey = "insurance",
            ApplyButtonLabel = "Get Insured", AmountFieldLabel = "Preferred Sum Insured", ShortLabel = "Insurance",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("premium", "Premium", FieldDataType.Currency, "/year onwards", true, true, true, true, true, false, true, false, 1),
                Field("coverage", "Coverage", FieldDataType.Text, "", true, false, false, true, true, false, false, true, 2),
                Field("policy_term", "Policy Term", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 3),
            }
        };
        var ptMutualFund = new ProductType
        {
            Name = "Mutual Fund", Code = "mutual-fund", IconKey = "investments",
            ApplyButtonLabel = "Invest Now", AmountFieldLabel = "Investment Amount", ShortLabel = "Investment",
            FieldDefinitions = new List<FieldDefinition>
            {
                Field("expected_returns", "Expected Returns", FieldDataType.Percentage, " p.a. (3Y avg)", true, true, true, true, true, false, true, false, 1),
                Field("min_investment", "Minimum Investment", FieldDataType.Currency, "", true, true, false, true, true, true, false, true, 2),
                Field("risk_level", "Risk Level", FieldDataType.Text, "", false, true, false, false, true, false, false, false, 3),
                Field("fund_type", "Fund Type", FieldDataType.Text, "", false, false, false, false, true, false, false, false, 4),
            }
        };

        db.ProductTypes.AddRange(ptLoan, ptCard, ptFd, ptRd, ptSavings, ptCurrent, ptInsurance, ptMutualFund);

        // ---------------- Products ----------------
        var products = new List<Product>();
        var allBenefits = new List<ProductBenefit>();
        var allEligibility = new List<ProductEligibility>();
        var allFieldValues = new List<ProductFieldValue>();
        var allReviews = new List<Review>();
        var allPromotions = new List<Promotion>();

        Product NewProduct(string name, string code, string shortDesc, string desc, string icon, Category cat, ProductType type, string status, int ageDays)
        {
            var p = new Product
            {
                Name = name, Code = code, ShortDescription = shortDesc, Description = desc, IconKey = icon,
                CategoryId = cat.Id, Category = cat, ProductTypeId = type.Id, ProductType = type, Status = status,
                CreatedAt = now.AddDays(-ageDays), UpdatedAt = now.AddDays(-(ageDays / 3)),
                ViewCount = 0
            };
            products.Add(p);
            return p;
        }

        void Values(Product p, ProductType type, params (string key, string value)[] vals)
        {
            foreach (var (key, value) in vals)
            {
                var def = type.FieldDefinitions.First(f => f.Key == key);
                decimal? numeric = decimal.TryParse(value, out var d) ? d : null;
                allFieldValues.Add(new ProductFieldValue { ProductId = p.Id, Product = p, FieldDefinitionId = def.Id, FieldDefinition = def, Value = value, NumericValue = numeric });
            }
        }

        void Benefits(Product p, params (string title, string desc, string icon)[] items)
        {
            int order = 0;
            foreach (var (title, desc, icon) in items)
                allBenefits.Add(new ProductBenefit { ProductId = p.Id, Product = p, Title = title, Description = desc, IconKey = icon, SortOrder = order++ });
        }

        void Eligibility(Product p, params (string criteria, string desc)[] items)
        {
            int order = 0;
            foreach (var (criteria, desc) in items)
                allEligibility.Add(new ProductEligibility { ProductId = p.Id, Product = p, Criteria = criteria, Description = desc, SortOrder = order++ });
        }

        void Reviews(Product p, params (string name, int rating, string comment, string status, int daysAgo)[] items)
        {
            foreach (var (name, rating, comment, status, daysAgo) in items)
                allReviews.Add(new Review
                {
                    ProductId = p.Id, Product = p, CustomerName = name,
                    CustomerEmail = $"{name.ToLower().Replace(" ", ".")}@example.com",
                    Rating = rating, Comment = comment, Status = status,
                    CreatedAt = now.AddDays(-daysAgo), UpdatedAt = now.AddDays(-daysAgo)
                });
        }

        void Promo(Product p, string title, string desc, string badge, string offer, string terms, int startDaysAgo, int endDaysFromNow, int priority, string status)
        {
            allPromotions.Add(new Promotion
            {
                ProductId = p.Id, Product = p, Title = title, Description = desc, BadgeText = badge, OfferDetail = offer,
                TermsAndConditions = terms, StartDate = now.AddDays(-startDaysAgo), EndDate = now.AddDays(endDaysFromNow),
                Priority = priority, Status = status, CreatedAt = now.AddDays(-startDaysAgo), UpdatedAt = now
            });
        }

        void RecalcRating(Product p)
        {
            var published = allReviews.Where(r => r.ProductId == p.Id && r.Status == "Published").ToList();
            p.RatingCount = published.Count;
            p.RatingAverage = published.Count == 0 ? 0 : Math.Round(published.Average(r => r.Rating), 1);
        }

        // ---- Loans ----
        var personalLoan = NewProduct("Personal Loan", "PL-001", "Get funds for personal needs", "Unsecured personal loan with quick disbursal, minimal documentation and flexible tenure for any personal financial requirement.", "loan", catLoans, ptLoan, "Active", 60);
        Values(personalLoan, ptLoan, ("interest_rate", "10.50"), ("loan_amount", "₹50,000 - ₹40,00,000"), ("tenure", "12 - 60 months"), ("processing_fee", "2.5"), ("min_income", "25,000"));
        Benefits(personalLoan, ("Quick Approval", "Get approved within 24 hours of application", "check"), ("Minimal Documents", "Only PAN, Aadhaar and income proof required", "check"), ("No Collateral", "Fully unsecured, no asset pledge needed", "shield"));
        Eligibility(personalLoan, ("Age 21-58 years", "Salaried or self-employed individuals"), ("Minimum income ₹25,000/month", "Net take-home salary requirement"), ("Credit score 700+", "CIBIL score of 700 or above preferred"));
        Reviews(personalLoan, ("Aarav Sharma", 5, "Disbursed within a day, very smooth process.", "Published", 5), ("Priya Nair", 4, "Good rate but documentation took a bit longer.", "Published", 12), ("Rohan Gupta", 5, "Excellent customer service throughout.", "Published", 20), ("Neha Kapoor", 3, "Average experience, expected faster response.", "Pending", 2));
        Promo(personalLoan, "Special Interest Rate", "Limited period offer on personal loans", "Special Rate", "Get interest rate starting at 10.50% for new applicants", "Offer valid for salaried applicants with credit score above 750. Bank reserves the right to withdraw at any time.", 5, 25, 10, "Active");

        var homeLoan = NewProduct("Home Loan", "HL-001", "Make your dream home a reality", "Attractive home loan offering with long repayment tenure to help you own your dream home with ease.", "loan", catLoans, ptLoan, "Active", 90);
        Values(homeLoan, ptLoan, ("interest_rate", "8.35"), ("loan_amount", "₹5,00,000 - ₹5 Crore"), ("tenure", "5 - 30 years"), ("processing_fee", "0.5"), ("min_income", "30,000"));
        Benefits(homeLoan, ("Tax Benefits", "Avail tax deduction under Section 80C and 24(b)", "check"), ("Low Interest Rate", "Among the most competitive rates in the market", "percent"), ("Balance Transfer", "Transfer your existing home loan at a lower rate", "check"));
        Eligibility(homeLoan, ("Age 21-65 years", "At loan maturity"), ("Minimum income ₹30,000/month", "Stable income source required"), ("Property must be bank-approved", "Located within approved project list"));
        Reviews(homeLoan, ("Ishaan Verma", 5, "Best home loan rates I found anywhere.", "Published", 8), ("Ananya Iyer", 5, "Smooth process from application to disbursal.", "Published", 15), ("Karan Malhotra", 4, "Good experience overall.", "Published", 30));

        var businessLoan = NewProduct("Business Loan", "BL-001", "Fuel your business growth", "Flexible business financing solution for working capital, expansion and equipment purchase needs.", "loan", catLoans, ptLoan, "Active", 45);
        Values(businessLoan, ptLoan, ("interest_rate", "12.00"), ("loan_amount", "₹1,00,000 - ₹2 Crore"), ("tenure", "12 - 84 months"), ("processing_fee", "2.0"), ("min_income", "50,000"));
        Benefits(businessLoan, ("No Collateral up to ₹50L", "Unsecured financing for eligible businesses", "shield"), ("Flexible Repayment", "Choose EMI plans that suit your cash flow", "check"));
        Eligibility(businessLoan, ("Business vintage 2+ years", "Existing profitable operations"), ("Annual turnover ₹10L+", "Minimum turnover requirement"));
        Reviews(businessLoan, ("Divya Patel", 4, "Helped us expand our inventory quickly.", "Published", 18));

        var educationLoan = NewProduct("Education Loan", "EL-001", "Invest in your future", "Education loan covering tuition, accommodation and other expenses for domestic and international studies.", "loan", catLoans, ptLoan, "PendingReview", 10);
        Values(educationLoan, ptLoan, ("interest_rate", "9.50"), ("loan_amount", "₹1,00,000 - ₹1.5 Crore"), ("tenure", "5 - 15 years"), ("processing_fee", "1.0"), ("min_income", "20,000"));
        Benefits(educationLoan, ("Moratorium Period", "Repayment starts after course completion", "check"), ("Covers Full Cost", "Tuition, hostel, books and travel covered", "check"));
        Eligibility(educationLoan, ("Admission confirmed", "In a recognized institution"), ("Co-applicant required", "Parent or guardian as co-borrower"));

        var vehicleLoan = NewProduct("Vehicle Loan", "VL-001", "Drive home your dream car", "Competitive auto loan for new and used vehicles with fast approval and doorstep service.", "loan", catLoans, ptLoan, "Active", 70);
        Values(vehicleLoan, ptLoan, ("interest_rate", "9.00"), ("loan_amount", "₹1,00,000 - ₹1 Crore"), ("tenure", "12 - 84 months"), ("processing_fee", "1.5"), ("min_income", "20,000"));
        Benefits(vehicleLoan, ("Up to 100% Financing", "On-road price fully financed for select models", "check"), ("Quick Approval", "Sanction within a few hours", "check"));
        Eligibility(vehicleLoan, ("Age 21-65 years", "At the time of application"), ("Minimum income ₹20,000/month", "Stable income proof required"));
        Reviews(vehicleLoan, ("Sanya Rao", 4, "Fast disbursal, helped me buy my first car.", "Published", 22));

        var goldLoan = NewProduct("Gold Loan", "GL-001", "Instant cash against your gold", "Quick loan against gold jewellery with attractive interest rates and same-day disbursal.", "loan", catLoans, ptLoan, "Active", 40);
        Values(goldLoan, ptLoan, ("interest_rate", "7.50"), ("loan_amount", "₹10,000 - ₹50,00,000"), ("tenure", "3 - 36 months"), ("processing_fee", "1.0"), ("min_income", "0"));
        Benefits(goldLoan, ("Same Day Disbursal", "Cash in hand within hours", "check"), ("High Loan to Value", "Get up to 75% of gold value", "check"));
        Eligibility(goldLoan, ("Age 18+ years", "Any occupation"), ("Gold ownership proof", "Purity certified at branch"));

        // ---- Credit Cards ----
        var platinumCard = NewProduct("Platinum Credit Card", "CC-PLAT", "Premium rewards on every spend", "A premium lifestyle credit card offering accelerated rewards, airport lounge access and exclusive privileges.", "credit-card", catCards, ptCard, "Active", 55);
        Values(platinumCard, ptCard, ("joining_fee", "999"), ("annual_fee", "999"), ("credit_limit", "₹1,00,000 - ₹10,00,000"), ("cashback", "2"), ("reward_rate", "5X on dining & travel"));
        Benefits(platinumCard, ("Lounge Access", "8 complimentary airport lounge visits per year", "star"), ("5X Reward Points", "On dining, travel and entertainment", "star"), ("Fuel Surcharge Waiver", "1% waiver at all fuel stations", "check"));
        Eligibility(platinumCard, ("Age 21-60 years", "Salaried or self-employed"), ("Minimum income ₹1,00,000/month", "Net annual income requirement"));
        Reviews(platinumCard, ("Kabir Bose", 5, "Lounge access alone is worth the annual fee.", "Published", 6), ("Meera Chatterjee", 4, "Great rewards, wish annual fee was waived.", "Published", 14));
        Promo(platinumCard, "Zero Joining Fee", "Sign up this month and pay no joining fee", "Zero Fee", "Joining fee fully waived for first 500 applicants this month", "Applicable only for new-to-bank customers. Annual fee applies from second year.", 3, 20, 9, "Active");

        var cashbackCard = NewProduct("Cashback Credit Card", "CC-CASH", "Earn cashback on every spend", "Simple, no-fuss credit card that gives flat cashback on all your everyday purchases.", "credit-card", catCards, ptCard, "Active", 50);
        Values(cashbackCard, ptCard, ("joining_fee", "0"), ("annual_fee", "500"), ("credit_limit", "₹50,000 - ₹5,00,000"), ("cashback", "5"), ("reward_rate", "1% on all other spends"));
        Benefits(cashbackCard, ("5% Cashback", "On groceries, utility bills and online shopping", "percent"), ("No Joining Fee", "Zero cost to get started", "check"));
        Eligibility(cashbackCard, ("Age 21-60 years", "Salaried or self-employed"), ("Minimum income ₹25,000/month", "Net monthly income requirement"));
        Reviews(cashbackCard, ("Rahul Sharma", 5, "Cashback adds up fast on daily spends.", "Published", 9));

        var travelCard = NewProduct("Travel Credit Card", "CC-TRAVEL", "Earn miles on every journey", "Travel-focused credit card with air miles, hotel benefits and zero forex markup for international spends.", "credit-card", catCards, ptCard, "PendingReview", 5);
        Values(travelCard, ptCard, ("joining_fee", "2999"), ("annual_fee", "2999"), ("credit_limit", "₹2,00,000 - ₹15,00,000"), ("cashback", "1"), ("reward_rate", "4 miles per ₹100 spent"));
        Benefits(travelCard, ("Zero Forex Markup", "No additional charges on international transactions", "check"), ("Complimentary Hotel Nights", "2 free nights at partner hotels annually", "star"));
        Eligibility(travelCard, ("Age 21-60 years", "Salaried or self-employed"), ("Minimum income ₹1,50,000/month", "Net annual income requirement"));

        // ---- Deposits ----
        var fixedDeposit = NewProduct("Fixed Deposit", "FD-001", "Secure your future with FD", "Grow your savings safely with guaranteed returns and flexible tenure options.", "deposit", catDeposits, ptFd, "Active", 65);
        Values(fixedDeposit, ptFd, ("interest_rate", "7.25"), ("min_deposit", "10,000"), ("tenure", "7 days - 10 years"), ("maturity_benefit", "Principal + compounded interest paid at maturity"));
        Benefits(fixedDeposit, ("Flexible Tenure", "Choose from 7 days up to 10 years", "check"), ("Safe & Secure", "Deposit insured up to ₹5,00,000", "shield"));
        Eligibility(fixedDeposit, ("Resident individuals", "Indian residents and NRIs"), ("Minimum deposit ₹10,000", "One-time lump sum deposit"));
        Reviews(fixedDeposit, ("Simran Kaur", 5, "Reliable returns, easy to open online.", "Published", 11), ("Arjun Reddy", 4, "Good rates compared to other banks.", "Published", 25));
        Promo(fixedDeposit, "Special FD Rate", "Extra 0.25% for senior citizens", "Special Rate", "Senior citizens earn an additional 0.25% p.a. on all tenures", "Valid for deposits made before offer end date. Subject to KYC verification.", 10, 30, 7, "Active");

        var taxSaverFd = NewProduct("Tax Saver Fixed Deposit", "FD-002", "Save tax while you save money", "5-year tax saving fixed deposit eligible for deduction under Section 80C.", "deposit", catDeposits, ptFd, "Active", 35);
        Values(taxSaverFd, ptFd, ("interest_rate", "7.00"), ("min_deposit", "1,000"), ("tenure", "5 years (lock-in)"), ("maturity_benefit", "Tax deduction up to ₹1,50,000 under Sec 80C"));
        Benefits(taxSaverFd, ("Tax Deduction", "Save up to ₹46,800 in taxes annually", "percent"), ("Guaranteed Returns", "Fixed interest for the entire tenure", "check"));
        Eligibility(taxSaverFd, ("Resident individuals & HUF", "As per Income Tax Act eligibility"));

        var recurringDeposit = NewProduct("Recurring Deposit", "RD-001", "Save little, earn more", "Build a disciplined savings habit with monthly deposits and attractive interest rates.", "deposit", catDeposits, ptRd, "Active", 28);
        Values(recurringDeposit, ptRd, ("interest_rate", "7.00"), ("min_monthly_deposit", "500"), ("tenure", "6 months - 10 years"));
        Benefits(recurringDeposit, ("Low Entry Amount", "Start with as little as ₹500/month", "check"), ("Auto Debit", "Convenient standing instruction from your account", "check"));
        Eligibility(recurringDeposit, ("Resident individuals", "Single or joint account holders"));
        Reviews(recurringDeposit, ("Vivaan Nair", 4, "Great way to build savings discipline.", "Published", 16));

        // ---- Accounts ----
        var savingsAccount = NewProduct("Savings Account", "SA-001", "Smart savings for everyday needs", "Zero-hassle savings account with digital banking, debit card and attractive interest rates.", "accounts", catAccounts, ptSavings, "Active", 80);
        Values(savingsAccount, ptSavings, ("interest_rate", "3.50"), ("min_balance", "10,000"), ("account_type", "Regular Savings"));
        Benefits(savingsAccount, ("Free Debit Card", "Zero annual fee for the first year", "check"), ("Free Digital Banking", "Mobile and net banking at no cost", "check"));
        Eligibility(savingsAccount, ("Age 18+ years", "Valid KYC documents required"));
        Reviews(savingsAccount, ("Aditi Sharma", 5, "Great mobile app experience.", "Published", 7));

        var premiumSavings = NewProduct("Premium Savings Account", "SA-002", "Elevated banking experience", "Premium savings account with higher interest, dedicated relationship manager and premium debit card.", "accounts", catAccounts, ptSavings, "Active", 20);
        Values(premiumSavings, ptSavings, ("interest_rate", "4.00"), ("min_balance", "50,000"), ("account_type", "Premium Savings"));
        Benefits(premiumSavings, ("Dedicated RM", "Personal relationship manager for banking needs", "star"), ("Higher Interest", "Earn more on your idle balance", "percent"));
        Eligibility(premiumSavings, ("Age 18+ years", "Valid KYC documents required"), ("Minimum balance ₹50,000", "Average monthly balance requirement"));

        var currentAccount = NewProduct("Current Account", "CA-001", "Built for business banking", "Current account designed for businesses with high transaction volumes and overdraft facility.", "accounts", catAccounts, ptCurrent, "Inactive", 100);
        Values(currentAccount, ptCurrent, ("min_balance", "25,000"), ("monthly_transactions", "Unlimited"), ("features", "Overdraft facility, cheque book, POS terminal"));
        Benefits(currentAccount, ("Overdraft Facility", "Access funds beyond your balance", "check"));
        Eligibility(currentAccount, ("Registered business entity", "GST/business registration required"));

        // ---- Investments ----
        var balancedFund = NewProduct("Balanced Growth Mutual Fund", "MF-001", "Balanced growth for long-term goals", "A hybrid mutual fund balancing equity and debt for steady, long-term wealth creation.", "investments", catInvestments, ptMutualFund, "Active", 42);
        Values(balancedFund, ptMutualFund, ("expected_returns", "11.50"), ("min_investment", "500"), ("risk_level", "Moderate"), ("fund_type", "Hybrid - Equity + Debt"));
        Benefits(balancedFund, ("SIP from ₹500", "Start investing with a small monthly amount", "check"), ("Diversified Portfolio", "Balanced exposure across asset classes", "check"));
        Eligibility(balancedFund, ("KYC compliant investors", "PAN and Aadhaar linked required"));
        Reviews(balancedFund, ("Ishaan Verma", 4, "Steady returns, good for beginners.", "Published", 13));

        var equityFund = NewProduct("Equity Advantage Fund", "MF-002", "Aggressive growth through equities", "High-growth equity mutual fund for investors with a higher risk appetite and long investment horizon.", "investments", catInvestments, ptMutualFund, "Draft", 3);
        Values(equityFund, ptMutualFund, ("expected_returns", "14.20"), ("min_investment", "1,000"), ("risk_level", "High"), ("fund_type", "Equity - Large & Mid Cap"));
        Benefits(equityFund, ("High Growth Potential", "Historically higher long-term returns", "star"));
        Eligibility(equityFund, ("KYC compliant investors", "Suitable for investors with 5+ year horizon"));

        // ---- Insurance ----
        var healthInsurance = NewProduct("Health Insurance", "HI-001", "Comprehensive health coverage", "Family health insurance plan covering hospitalization, day-care procedures and pre/post care expenses.", "insurance", catInsurance, ptInsurance, "Active", 58);
        Values(healthInsurance, ptInsurance, ("premium", "8,999"), ("coverage", "₹5,00,000 - ₹1 Crore"), ("policy_term", "1 / 2 / 3 years"));
        Benefits(healthInsurance, ("Cashless Hospitalization", "At 10,000+ network hospitals", "check"), ("No Claim Bonus", "Coverage increases every claim-free year", "star"));
        Eligibility(healthInsurance, ("Age 18-65 years", "Proposer age at entry"), ("Pre-existing disease waiting period", "36 months as per policy terms"));
        Reviews(healthInsurance, ("Meera Chatterjee", 5, "Claim settlement was quick and hassle-free.", "Published", 4), ("Karan Malhotra", 4, "Good coverage for the premium paid.", "Published", 19));

        var lifeInsurance = NewProduct("Life Insurance", "LI-001", "Secure your family's future", "Term life insurance plan offering high coverage at affordable premiums for complete financial protection.", "insurance", catInsurance, ptInsurance, "Active", 48);
        Values(lifeInsurance, ptInsurance, ("premium", "6,500"), ("coverage", "₹50,00,000 - ₹2 Crore"), ("policy_term", "10 - 40 years"));
        Benefits(lifeInsurance, ("High Cover, Low Premium", "Affordable term plans with large sum assured", "check"), ("Tax Benefits", "Premium eligible under Section 80C", "percent"));
        Eligibility(lifeInsurance, ("Age 18-65 years", "Proposer age at entry"), ("Medical checkup may be required", "Based on sum assured and age"));

        var vehicleInsurance = NewProduct("Vehicle Insurance", "VI-001", "Complete protection for your vehicle", "Comprehensive motor insurance covering own damage, third-party liability and add-on covers.", "insurance", catInsurance, ptInsurance, "PendingReview", 6);
        Values(vehicleInsurance, ptInsurance, ("premium", "3,200"), ("coverage", "IDV based, up to ₹15,00,000"), ("policy_term", "1 / 2 / 3 years"));
        Benefits(vehicleInsurance, ("Zero Depreciation Cover", "Full claim value with add-on", "check"), ("24x7 Roadside Assistance", "Emergency support anywhere, anytime", "check"));
        Eligibility(vehicleInsurance, ("Valid driving license", "For the insured vehicle"));

        db.Products.AddRange(products);
        db.ProductFieldValues.AddRange(allFieldValues);
        db.ProductBenefits.AddRange(allBenefits);
        db.ProductEligibilities.AddRange(allEligibility);

        foreach (var p in products) RecalcRating(p);

        db.Reviews.AddRange(allReviews);
        db.Promotions.AddRange(allPromotions);

        // ---------------- Applications ----------------
        var activeProducts = products.Where(p => p.Status == "Active").ToArray();
        var rnd = new Random(42);
        var statuses = new[] { "Submitted", "UnderReview", "DocumentsRequired", "Approved", "Rejected", "Completed" };
        var applications = new List<DomainApplication>();
        var appFieldValues = new List<ApplicationFieldValue>();
        var appDocuments = new List<ApplicationDocument>();
        var appHistory = new List<ApplicationStatusHistory>();

        for (int i = 1; i <= 24; i++)
        {
            var product = activeProducts[rnd.Next(activeProducts.Length)];
            var status = statuses[rnd.Next(statuses.Length)];
            var firstName = FirstNames[rnd.Next(FirstNames.Length)];
            var lastName = LastNames[rnd.Next(LastNames.Length)];
            var daysAgo = rnd.Next(1, 45);
            var createdAt = now.AddDays(-daysAgo);

            var app = new DomainApplication
            {
                ApplicationNumber = $"APP-{now:yyyy}-{1000 + i}",
                ProductId = product.Id,
                Product = product,
                CustomerName = $"{firstName} {lastName}",
                CustomerEmail = $"{firstName.ToLower()}.{lastName.ToLower()}@example.com",
                CustomerPhone = $"+91 9{rnd.Next(100000000, 999999999)}",
                Status = status,
                ReviewNotes = status == "Rejected" ? "Did not meet minimum eligibility criteria." : status == "Approved" || status == "Completed" ? "All documents verified. Approved for disbursal." : "",
                CreatedAt = createdAt,
                SubmittedAt = createdAt.AddHours(1),
                UpdatedAt = createdAt.AddDays(Math.Min(daysAgo, rnd.Next(1, 5)))
            };
            applications.Add(app);
            product.ApplicationCount++;

            appFieldValues.Add(new ApplicationFieldValue { ApplicationId = app.Id, Application = app, FieldKey = "requested_amount", FieldLabel = "Requested Amount", Value = $"₹{rnd.Next(1, 20) * 50000:N0}" });
            appFieldValues.Add(new ApplicationFieldValue { ApplicationId = app.Id, Application = app, FieldKey = "employment_type", FieldLabel = "Employment Type", Value = rnd.Next(2) == 0 ? "Salaried" : "Self-Employed" });
            appFieldValues.Add(new ApplicationFieldValue { ApplicationId = app.Id, Application = app, FieldKey = "monthly_income", FieldLabel = "Monthly Income", Value = $"₹{rnd.Next(25, 200) * 1000:N0}" });

            appDocuments.Add(new ApplicationDocument { ApplicationId = app.Id, Application = app, DocumentName = "PAN Card", DocumentType = "Identity", Required = true, Uploaded = true, FileName = "pan_card.pdf", UploadedAt = createdAt.AddHours(2) });
            appDocuments.Add(new ApplicationDocument { ApplicationId = app.Id, Application = app, DocumentName = "Address Proof", DocumentType = "Address", Required = true, Uploaded = true, FileName = "address_proof.pdf", UploadedAt = createdAt.AddHours(2) });
            appDocuments.Add(new ApplicationDocument { ApplicationId = app.Id, Application = app, DocumentName = "Income Proof", DocumentType = "Financial", Required = true, Uploaded = status != "DocumentsRequired", FileName = status != "DocumentsRequired" ? "income_proof.pdf" : "" });

            appHistory.Add(new ApplicationStatusHistory { ApplicationId = app.Id, Application = app, Status = "Draft", Note = "Application started", ChangedAt = createdAt });
            appHistory.Add(new ApplicationStatusHistory { ApplicationId = app.Id, Application = app, Status = "Submitted", Note = "Application submitted for review", ChangedAt = createdAt.AddHours(1) });
            if (status != "Submitted")
                appHistory.Add(new ApplicationStatusHistory { ApplicationId = app.Id, Application = app, Status = status, Note = app.ReviewNotes == "" ? "Status updated" : app.ReviewNotes, ChangedAt = app.UpdatedAt });
        }

        db.Applications.AddRange(applications);
        db.ApplicationFieldValues.AddRange(appFieldValues);
        db.ApplicationDocuments.AddRange(appDocuments);
        db.ApplicationStatusHistories.AddRange(appHistory);

        // ---------------- Search Logs (seed a realistic baseline) ----------------
        db.SearchLogs.AddRange(
            new SearchLog { Term = "personal loan", HitCount = 812, LastSearchedAt = now.AddHours(-2) },
            new SearchLog { Term = "home loan", HitCount = 634, LastSearchedAt = now.AddHours(-5) },
            new SearchLog { Term = "credit card", HitCount = 521, LastSearchedAt = now.AddHours(-1) },
            new SearchLog { Term = "fixed deposit", HitCount = 398, LastSearchedAt = now.AddHours(-8) },
            new SearchLog { Term = "health insurance", HitCount = 276, LastSearchedAt = now.AddHours(-12) }
        );

        await db.SaveChangesAsync();
        }

        // Backfill ProductType labels if missing
        var existingTypes = await db.ProductTypes.ToListAsync();
        bool changedTypes = false;
        foreach (var pt in existingTypes)
        {
            if (string.IsNullOrEmpty(pt.ApplyButtonLabel) || string.IsNullOrEmpty(pt.AmountFieldLabel) || string.IsNullOrEmpty(pt.ShortLabel))
            {
                changedTypes = true;
                if (string.IsNullOrEmpty(pt.ApplyButtonLabel))
                {
                    pt.ApplyButtonLabel = pt.Code switch
                    {
                        "mutual-fund" => "Invest Now",
                        "fixed-deposit" or "recurring-deposit" => "Open Deposit",
                        "savings-account" or "current-account" => "Open Account",
                        "insurance" => "Get Insured",
                        _ => "Apply Now"
                    };
                }
                if (string.IsNullOrEmpty(pt.AmountFieldLabel))
                {
                    pt.AmountFieldLabel = pt.Code switch
                    {
                        "fixed-deposit" => "Deposit Amount",
                        "recurring-deposit" => "Monthly Deposit Amount",
                        "mutual-fund" => "Investment Amount",
                        "savings-account" or "current-account" => "Initial Funding Amount",
                        "insurance" => "Preferred Sum Insured",
                        "credit-card" => "Credit Limit",
                        _ => "Requested Amount"
                    };
                }
                if (string.IsNullOrEmpty(pt.ShortLabel))
                {
                    pt.ShortLabel = pt.Code switch
                    {
                        "loan" => "Loan",
                        "credit-card" => "Card",
                        "fixed-deposit" or "recurring-deposit" => "Deposit",
                        "savings-account" or "current-account" => "Account",
                        "insurance" => "Insurance",
                        "mutual-fund" => "Investment",
                        _ => pt.Name
                    };
                }
            }
        }
        if (changedTypes)
        {
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Seeds ProductViewLogs and AuditLogs from whatever is currently in the database.
    /// Runs independently of <see cref="SeedAsync"/> (guarded per-table) so it safely backfills
    /// these newer tables against a database that was already seeded before they existed,
    /// without needing to touch or reset any existing data.
    /// </summary>
    public static async Task SeedAnalyticsAndAuditAsync(AppDbContext db)
    {
        var now = DateTime.UtcNow;
        var rnd = new Random(7);

        if (!await db.ProductViewLogs.AnyAsync())
        {
            var products = await db.Products.ToListAsync();
            var viewLogs = new List<ProductViewLog>();
            foreach (var p in products)
            {
                var viewsForProduct = p.Status == "Active" ? rnd.Next(120, 420) : rnd.Next(10, 90);
                for (int v = 0; v < viewsForProduct; v++)
                {
                    var daysAgo = (int)(Math.Pow(rnd.NextDouble(), 2) * 44);
                    viewLogs.Add(new ProductViewLog { ProductId = p.Id, ViewedAt = now.AddDays(-daysAgo).AddMinutes(-rnd.Next(0, 1440)) });
                }
                p.ViewCount = viewsForProduct;
            }
            db.ProductViewLogs.AddRange(viewLogs);
            await db.SaveChangesAsync();
        }

        if (!await db.AuditLogs.AnyAsync())
        {
            var admins = new[]
            {
                ("Super Admin", "admin@omniconnect.bank"),
                ("Priya Menon", "priya.menon@omniconnect.bank"),
                ("Arjun Desai", "arjun.desai@omniconnect.bank"),
            };
            (string name, string email) RandomAdmin() => admins[rnd.Next(admins.Length)];

            var auditLogs = new List<AuditLog>();
            void Audit(string action, string entityType, Guid? entityId, string entityName, string description, int daysAgo, string? prev = null, string? next = null)
            {
                var (name, email) = RandomAdmin();
                auditLogs.Add(new AuditLog
                {
                    Timestamp = now.AddDays(-Math.Max(daysAgo, 0)).AddMinutes(-rnd.Next(0, 1440)),
                    ActorName = name,
                    ActorEmail = email,
                    Action = action,
                    EntityType = entityType,
                    EntityId = entityId,
                    EntityName = entityName,
                    Description = description,
                    Success = true,
                    PreviousValue = prev,
                    NewValue = next
                });
            }

            var products = await db.Products.ToListAsync();
            foreach (var p in products)
            {
                var ageDays = (int)(now - p.CreatedAt).TotalDays;
                Audit(AuditActions.CreateProduct, AuditEntityTypes.Product, p.Id, p.Name, $"Created product \"{p.Name}\"", ageDays);
                if (p.Status is "Active" or "Inactive")
                    Audit(AuditActions.ProductStatusChange, AuditEntityTypes.Product, p.Id, p.Name,
                        $"Changed status of \"{p.Name}\" from Draft to {p.Status}", ageDays - 1, "Draft", p.Status.ToString());
            }

            var categories = await db.Categories.ToListAsync();
            foreach (var c in categories)
                Audit(AuditActions.CreateCategory, AuditEntityTypes.Category, c.Id, c.Name, $"Created category \"{c.Name}\"", (int)(now - c.CreatedAt).TotalDays);

            var promotions = await db.Promotions.Include(p => p.Product).ToListAsync();
            foreach (var promo in promotions)
                Audit(AuditActions.CreatePromotion, AuditEntityTypes.Promotion, promo.Id, promo.Title, $"Created promotion \"{promo.Title}\" for {promo.Product.Name}", (int)(now - promo.CreatedAt).TotalDays);

            var reviews = await db.Reviews.Include(r => r.Product).Where(r => r.Status != "Pending").ToListAsync();
            foreach (var r in reviews)
                Audit(AuditActions.ReviewStatusChange, AuditEntityTypes.Review, r.Id, r.Product.Name,
                    $"Changed review by {r.CustomerName} on \"{r.Product.Name}\" from Pending to {r.Status}", (int)(now - r.UpdatedAt).TotalDays, "Pending", r.Status.ToString());

            var applications = await db.Applications.Include(a => a.Product).ToListAsync();
            foreach (var app in applications)
            {
                Audit(AuditActions.CreateApplication, AuditEntityTypes.Application, app.Id, app.ApplicationNumber,
                    $"{app.CustomerName} submitted application {app.ApplicationNumber} for {app.Product.Name}", (int)(now - app.CreatedAt).TotalDays);
                if (app.Status != "Submitted")
                    Audit(AuditActions.ApplicationStatusChange, AuditEntityTypes.Application, app.Id, app.ApplicationNumber,
                        $"Application {app.ApplicationNumber} ({app.Product.Name}) status changed from Submitted to {app.Status}",
                        (int)(now - app.UpdatedAt).TotalDays, "Submitted", app.Status.ToString());
            }

            foreach (var term in new[] { "personal loan", "home loan", "credit card", "fixed deposit", "health insurance", "mutual fund" })
                Audit(AuditActions.Search, AuditEntityTypes.Search, null, term, $"Searched products for \"{term}\"", rnd.Next(0, 10));

            db.AuditLogs.AddRange(auditLogs);
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Seeds the default (global, applies-to-every-product-type) document requirements used by the
    /// Apply Now flow, so the previously-hardcoded "PAN Card / Address Proof / Income Proof" list keeps
    /// working out of the box while now being fully admin-editable from Setup > Documents.
    /// Idempotent and independent of <see cref="SeedAsync"/>, matching the pattern used for
    /// <see cref="SeedAnalyticsAndAuditAsync"/> so it safely backfills an already-seeded database.
    /// </summary>
    public static async Task SeedDocumentDefinitionsAsync(AppDbContext db)
    {
        if (await db.DocumentDefinitions.AnyAsync()) return;

        db.DocumentDefinitions.AddRange(
            new DocumentDefinition { Name = "PAN Card", DocumentType = "Identity", Required = true, SortOrder = 1, Active = true, ProductTypeId = null },
            new DocumentDefinition { Name = "Address Proof", DocumentType = "Address", Required = true, SortOrder = 2, Active = true, ProductTypeId = null },
            new DocumentDefinition { Name = "Income Proof", DocumentType = "Financial", Required = true, SortOrder = 3, Active = true, ProductTypeId = null }
        );

        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Seeds one StatusConfig row per (EntityType, Value) pair, matching exactly the tone/label the
    /// frontend previously had hardcoded in StatusBadge.tsx - so turning this feature on changes
    /// nothing visually until an admin actually edits a status from Setup. Idempotent per-entity so
    /// it also self-heals if a new status is added to an enum later (missing rows get created,
    /// existing admin-edited rows are left untouched).
    /// </summary>
    public static async Task SeedStatusConfigsAsync(AppDbContext db)
    {
        var existingKeys = (await db.StatusConfigs.Select(s => new { s.EntityType, s.Value }).ToListAsync())
            .Select(x => (x.EntityType, x.Value)).ToHashSet();

        var rows = new List<StatusConfig>();
        void Add(string entityType, string value, string label, string color, int order)
        {
            if (existingKeys.Contains((entityType, value))) return;
            rows.Add(new StatusConfig { EntityType = entityType, Value = value, Label = label, Color = color, Enabled = true, SortOrder = order });
        }

        Add(StatusEntityTypes.Product, "Draft", "Draft", "neutral", 1);
        Add(StatusEntityTypes.Product, "PendingReview", "Pending Review", "warning", 2);
        Add(StatusEntityTypes.Product, "Active", "Active", "success", 3);
        Add(StatusEntityTypes.Product, "Inactive", "Inactive", "danger", 4);

        Add(StatusEntityTypes.Category, "Active", "Active", "success", 1);
        Add(StatusEntityTypes.Category, "Inactive", "Inactive", "danger", 2);

        Add(StatusEntityTypes.Review, "Pending", "Pending", "warning", 1);
        Add(StatusEntityTypes.Review, "Published", "Published", "success", 2);
        Add(StatusEntityTypes.Review, "Rejected", "Rejected", "danger", 3);
        Add(StatusEntityTypes.Review, "Hidden", "Hidden", "danger", 4);

        Add(StatusEntityTypes.Promotion, "Draft", "Draft", "neutral", 1);
        Add(StatusEntityTypes.Promotion, "Scheduled", "Scheduled", "warning", 2);
        Add(StatusEntityTypes.Promotion, "Active", "Active", "success", 3);
        Add(StatusEntityTypes.Promotion, "Expired", "Expired", "danger", 4);
        Add(StatusEntityTypes.Promotion, "Inactive", "Inactive", "danger", 5);

        Add(StatusEntityTypes.Application, "Draft", "Draft", "neutral", 1);
        Add(StatusEntityTypes.Application, "Submitted", "Submitted", "info", 2);
        Add(StatusEntityTypes.Application, "UnderReview", "Under Review", "warning", 3);
        Add(StatusEntityTypes.Application, "DocumentsRequired", "Documents Required", "warning", 4);
        Add(StatusEntityTypes.Application, "Approved", "Approved", "success", 5);
        Add(StatusEntityTypes.Application, "Rejected", "Rejected", "danger", 6);
        Add(StatusEntityTypes.Application, "Cancelled", "Cancelled", "danger", 7);
        Add(StatusEntityTypes.Application, "Completed", "Completed", "success", 8);
        Add(StatusEntityTypes.Application, "Escalated", "Escalated", "warning", 9);
        Add(StatusEntityTypes.Application, "OnHold", "On Hold", "neutral", 10);

        if (rows.Count > 0)
        {
            db.StatusConfigs.AddRange(rows);
            await db.SaveChangesAsync();
        }

        // ---------------- Employment Types ----------------
        if (!await db.EmploymentTypes.AnyAsync())
        {
            var empTypes = new List<EmploymentType>
            {
                new() { Name = "Salaried", Active = true, SortOrder = 1, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { Name = "Self-Employed", Active = true, SortOrder = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { Name = "Business Owner", Active = true, SortOrder = 3, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { Name = "Retired", Active = true, SortOrder = 4, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            };
            db.EmploymentTypes.AddRange(empTypes);
            await db.SaveChangesAsync();
        }

        // ---------------- Ranking Config ----------------
        if (!await db.RankingConfigs.AnyAsync())
        {
            db.RankingConfigs.Add(new RankingConfig
            {
                TrendingViewWeight = 1.0,
                TrendingApplicationWeight = 3.0,
                RecommendedRatingWeight = 20.0,
                RecommendedApplicationWeight = 0.5,
                RecommendedPromotionWeight = 25.0,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
    }
}
