# Frontend Tests

This directory contains tests for the TradeDog frontend components.

## Setup

Install dependencies:

```bash
npm install
```

## Running Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode (for development):
```bash
npm run test:watch
```

Run tests with coverage:
```bash
npm run test:coverage
```

## Test Structure

- `__tests__/` - Contains test files
- Test files are named `*.test.tsx` or `*.test.ts`
- Tests use Jest and React Testing Library

## Strategy5MinPanel Tests

### Period Selection Tests

#### `should show 7 days of trade log when 7d period is selected`
- Verifies that when the 7d period button is clicked
- The backtest API is called with `period: '7d'`
- All trades within the 7-day window are displayed
- The date range correctly spans from oldest to newest trade

#### `should use Tiger data source for 7d period`
- Verifies that the 7d period uses Tiger API
- Checks that the Tiger badge (⚡ Tiger) is displayed

#### `should filter trades within 7d window`
- Ensures trades outside the 7-day window are not shown
- Validates proper date filtering

#### `should show loading state while fetching 7d data`
- Tests that "Fetching 7d data" message appears during load
- Verifies loading state disappears after data loads

#### `should display correct metrics for 7d period`
- Validates that performance metrics (win rate, return %, etc.)
- Are correctly displayed after backtest completes

## Adding New Tests

1. Create a new test file in `__tests__/` directory
2. Import the component and testing utilities
3. Mock any external dependencies (API calls, hooks)
4. Write test cases using `describe`, `it`, and `expect`

Example:
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import MyComponent from '../MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Mocking

### API Mocks
API calls are mocked using Jest:
```typescript
jest.mock('../../../services/api', () => ({
  fetchMGC5MinBacktest: jest.fn(),
}));
```

### Hook Mocks
Custom hooks are mocked:
```typescript
jest.mock('../../../hooks/useLivePrice', () => ({
  useLivePrice: () => ({ price: 2450.5 }),
}));
```

## Coverage

Coverage reports are generated in the `coverage/` directory.

View coverage:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Continuous Integration

Tests should pass before merging to main branches.
Run tests locally before committing.
