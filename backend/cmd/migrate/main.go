package main

import (
	"fmt"
	"os"

	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
)

func main() {
	args := os.Args[1:]
	var err error
	switch {
	case len(args) == 1 && args[0] == "up":
		err = migrations.Up(os.Getenv("DATABASE_URL"))
	case len(args) == 2 && args[0] == "down" && args[1] == "--confirm":
		err = migrations.Down(os.Getenv("DATABASE_URL"))
	default:
		fmt.Fprintln(os.Stderr, "usage: migrate up | migrate down --confirm")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
