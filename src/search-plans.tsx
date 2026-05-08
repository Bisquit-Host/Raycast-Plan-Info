import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";

type Currency = "eur" | "rub";
type PlanCategory = "Game" | "VDS" | "Bot";
type InfoFilter = "all" | "eur" | "rub" | "ram";
type LocationId = 1 | 2;

type ApiPrice = {
  price: number;
  currency: Currency;
};

type ApiPlan = {
  id: number;
  name: string;
  locationId?: LocationId;
  price: ApiPrice[];
  memory: number;
  whmcsLink?: string;
  enabled?: boolean;
};

type ApiResponse = {
  packages: ApiPlan[];
};

type Plan = {
  id: string;
  name: string;
  category: PlanCategory;
  priceEur?: number;
  priceRub?: number;
  ramGb: number;
  locationId?: LocationId;
  url?: string;
};

const endpoints: { category: PlanCategory; path: string }[] = [
  { category: "Game", path: "/api/game" },
  { category: "VDS", path: "/api/cloud" },
  { category: "Bot", path: "/api/bot" },
];

const baseUrl = "https://bisquit.host";

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const { data, error, isLoading, revalidate } = usePromise(fetchPlans);

  if (error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Could not fetch Bisquit.Host plans",
      message: error.message,
    });
  }

  const plans = data ?? [];
  const query = useMemo(() => parseSearch(searchText), [searchText]);
  const filteredPlans = useMemo(
    () => filterPlans(plans, query),
    [plans, query],
  );

  return (
    <List
      filtering={false}
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchText={searchText}
      searchBarPlaceholder="Search by plan name, then location"
    >
      {filteredPlans.map((plan) => (
        <List.Item
          key={plan.id}
          icon={iconForPlan(plan)}
          title={plan.name}
          subtitle={plan.category}
          accessories={accessoriesForPlan(plan, query.infoFilter)}
          actions={
            <ActionPanel>
              <Action
                title="Search Plan Name"
                icon={Icon.MagnifyingGlass}
                onAction={() => setSearchText(plan.name)}
              />
              <Action.CopyToClipboard
                title="Copy Plan Info"
                content={formatPlan(plan)}
              />
              <Action
                title="Refresh Plans"
                icon={Icon.ArrowClockwise}
                onAction={revalidate}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

async function fetchPlans(): Promise<Plan[]> {
  const responses = await Promise.all(
    endpoints.map(async (endpoint) => {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });

      if (!response.ok) {
        throw new Error(
          `${endpoint.category}: ${response.status} ${response.statusText}`,
        );
      }

      const body = (await response.json()) as ApiResponse;
      return body.packages
        .filter((plan) => plan.enabled !== false)
        .map((plan) => normalizePlan(endpoint.category, plan));
    }),
  );

  return responses
    .flat()
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
}

function normalizePlan(category: PlanCategory, plan: ApiPlan): Plan {
  const priceEur = plan.price.find((price) => price.currency === "eur")?.price;
  const priceRub = plan.price.find((price) => price.currency === "rub")?.price;

  return {
    id: `${category}-${plan.id}`,
    name: plan.name,
    category,
    priceEur,
    priceRub,
    ramGb: plan.memory / 1024,
    locationId: plan.locationId,
    url: plan.whmcsLink ? `${baseUrl}${plan.whmcsLink}` : undefined,
  };
}

function iconForPlan(plan: Plan) {
  if (plan.category === "Game") {
    return { source: flagForLocation(plan.locationId) };
  }

  switch (plan.category) {
    case "VDS":
      return Icon.HardDrive;
    case "Bot":
      return Icon.Terminal;
  }
}

function flagForLocation(locationId?: LocationId): string {
  switch (locationId) {
    case 1:
      return "flag-germany.png";
    case 2:
      return "flag-russia.png";
    default:
      return Icon.Map;
  }
}

function formatPlan(plan: Plan): string {
  return `${plan.name} (${plan.category}) - ${formatEur(plan.priceEur)} / ${formatRub(plan.priceRub)} - ${formatRam(plan.ramGb)} GB RAM`;
}

function filterPlans(plans: Plan[], query: SearchQuery): Plan[] {
  if (!query.name && !query.locationId) {
    return plans;
  }

  return plans.filter((plan) => {
    const matchesName =
      !query.name ||
      normalizeSearchText(plan.name).includes(query.name) ||
      normalizeSearchText(plan.category).includes(query.name);
    const matchesLocation =
      !query.locationId || plan.locationId === query.locationId;

    return matchesName && matchesLocation;
  });
}

type SearchQuery = {
  name: string;
  infoFilter: InfoFilter;
  locationId?: LocationId;
};

function parseSearch(searchText: string): SearchQuery {
  const tokens = searchText.trim().split(/\s+/).filter(Boolean);
  const infoFilter = infoFilterForSearchToken(tokens.at(-1));
  const searchTokens = infoFilter === "all" ? tokens : tokens.slice(0, -1);
  const locationId =
    searchTokens.length > 1
      ? locationIdForSearchToken(searchTokens.at(-1))
      : undefined;
  const nameTokens = locationId ? searchTokens.slice(0, -1) : searchTokens;

  return {
    name: normalizeSearchText(nameTokens.join("")),
    infoFilter,
    locationId,
  };
}

function infoFilterForSearchToken(token?: string): InfoFilter {
  switch (normalizeSearchText(token ?? "")) {
    case "eur":
      return "eur";
    case "rub":
      return "rub";
    case "ram":
    case "memory":
    case "gb":
      return "ram";
    default:
      return "all";
  }
}

function locationIdForSearchToken(token?: string): LocationId | undefined {
  const firstLetter = token?.trim().at(0)?.toLocaleLowerCase();

  switch (firstLetter) {
    case "g":
    case "f":
      return 1;
    case "r":
    case "m":
      return 2;
    default:
      return undefined;
  }
}

function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase().replaceAll(/[\s_-]/g, "");
}

function accessoriesForPlan(plan: Plan, infoFilter: InfoFilter) {
  switch (infoFilter) {
    case "eur":
      return [{ tag: formatEur(plan.priceEur) }];
    case "rub":
      return [{ tag: formatRub(plan.priceRub) }];
    case "ram":
      return [{ tag: `${formatRam(plan.ramGb)} GB RAM` }];
    case "all":
      return [
        { text: formatEur(plan.priceEur) },
        { text: formatRub(plan.priceRub) },
        { text: `${formatRam(plan.ramGb)} GB RAM` },
      ];
  }
}

function formatEur(price?: number): string {
  return price === undefined
    ? "EUR -"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "EUR",
      }).format(price);
}

function formatRub(price?: number): string {
  return price === undefined
    ? "RUB -"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(price);
}

function formatRam(ramGb: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    ramGb,
  );
}
